package androperator.operator.onscreenlog

import android.app.LocaleManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ImageSpan
import androperator.operator.foreground.ForegroundApplicationObserver
import androperator.task.runner.OnScreenLogTemplate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.util.Locale

internal data class OnScreenLogContent(val text: CharSequence, val truncated: Boolean = false)
internal data class OnScreenLogAppMetadata(
    val packageName: String,
    val versionCode: String = "Unavailable",
    val versionName: String = "Unavailable",
    val icon: Bitmap? = null,
)

/** One panel lifetime. Package cache, receivers and work disappear together on close. */
internal class OnScreenLogTemplateSession(
    private val context: Context,
    template: String,
    private val observer: () -> ForegroundApplicationObserver,
    private val fontSizeSp: Int,
    private val publish: (OnScreenLogContent) -> Unit,
    private val failed: () -> Unit,
    private val lookupDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val lookup: suspend (String) -> OnScreenLogAppMetadata = { loadMetadata(context, it) },
) {
    private val parts = OnScreenLogTemplate.parse(template)
    private val needsApp = parts.any { it.name?.startsWith("foreground_app.") == true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val changes = Channel<Unit>(Channel.CONFLATED)
    private val cache = object : LinkedHashMap<String, OnScreenLogAppMetadata>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, OnScreenLogAppMetadata>?) = size > 8
    }
    private var packageName: String? = null
    private var revision = 0L
    private var closed = false
    private var registered = false
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            cache.clear()
            refresh()
        }
    }
    private val packageReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val changed = intent?.data?.schemeSpecificPart ?: return
            cache.remove(changed)
            // Invalidate every pending read, including a read for another package.
            refresh()
        }
    }

    fun initial(): OnScreenLogContent = render(null)

    fun start() {
        check(!closed)
        try {
            context.registerReceiver(receiver, IntentFilter(Intent.ACTION_LOCALE_CHANGED))
            registered = true
            if (needsApp) {
                val filter = IntentFilter().apply {
                    addAction(Intent.ACTION_PACKAGE_ADDED)
                    addAction(Intent.ACTION_PACKAGE_REMOVED)
                    addAction(Intent.ACTION_PACKAGE_REPLACED)
                    addAction(Intent.ACTION_PACKAGE_CHANGED)
                    addDataScheme("package")
                }
                context.registerReceiver(packageReceiver, filter)
                scope.launch {
                    try {
                        @Suppress("DEPRECATION")
                        val displayId = (context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.displayId
                        observer().observe(displayId).collect { state ->
                            packageName = state.foregroundApp?.packageName
                            refresh()
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        if (!closed) failed()
                    }
                }
            }
            scope.launch {
                changes.receiveAsFlow().collectLatest {
                    val requestedRevision = revision
                    val requestedPackage = packageName
                    try {
                        val cached = requestedPackage?.let(cache::get)
                        if (requestedPackage != null && cached == null) {
                            val metadata = withContext(lookupDispatcher) { metadataPermits.withPermit { lookup(requestedPackage) } }
                            if (!closed && requestedRevision == revision) {
                                cache[requestedPackage] = metadata
                                publish(render(metadata))
                            }
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        if (!closed && requestedRevision == revision) failed()
                    }
                }
            }
            refresh()
        } catch (_: Exception) {
            close()
            failed()
        }
    }

    fun refresh() {
        if (closed) return
        revision++
        try {
            // A non-cancellable old lookup must not delay clearing its app fields on focus change.
            publish(render(packageName?.let { cache[it] ?: OnScreenLogAppMetadata(it) }))
            changes.trySend(Unit)
        } catch (_: Exception) {
            if (!closed) failed()
        }
    }

    fun close() {
        if (closed) return
        closed = true
        revision++
        scope.cancel()
        changes.close()
        cache.clear()
        if (registered) {
            runCatching { context.unregisterReceiver(receiver) }
            runCatching { context.unregisterReceiver(packageReceiver) }
        }
    }

    internal fun render(metadata: OnScreenLogAppMetadata?): OnScreenLogContent {
        val locale = systemLocale(context)
        val values = mapOf(
            "foreground_app.package_name" to (metadata?.packageName ?: "Unavailable"),
            "foreground_app.version_code" to (metadata?.versionCode ?: "Unavailable"),
            "foreground_app.version_name" to (metadata?.versionName ?: "Unavailable"),
            "device.manufacturer" to Build.MANUFACTURER,
            "device.model" to Build.MODEL,
            "system.language_code" to locale.language,
            "system.language_tag" to locale.toLanguageTag(),
            "system.language_name" to locale.getDisplayLanguage(locale),
        )
        val result = SpannableStringBuilder()
        var truncated = false
        val iconSize = (fontSizeSp * context.resources.displayMetrics.scaledDensity).toInt().coerceIn(1, 256)
        for (part in parts) {
            if (result.length >= OnScreenLogTemplate.MAX_EXPANDED_LENGTH) {
                truncated = true
                break
            }
            if (part.name == "foreground_app.icon") {
                val start = result.length
                result.append('\uFFFC')
                val bitmap = metadata?.icon ?: neutralIcon
                val drawable = BitmapDrawable(context.resources, bitmap).apply { setBounds(0, 0, iconSize, iconSize) }
                result.setSpan(ImageSpan(drawable, ImageSpan.ALIGN_BASELINE), start, result.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            } else {
                val raw = part.literal ?: values[part.name].orEmpty().ifBlank { "Unavailable" }
                val value = if (part.literal != null) raw else boundedValue(raw)
                if (value != raw) truncated = true
                val remaining = OnScreenLogTemplate.MAX_EXPANDED_LENGTH - result.length
                result.append(safePrefix(value, remaining))
                if (value.length > remaining) truncated = true
            }
        }
        if (truncated && result.isNotEmpty()) {
            val end = safePrefix(result.toString(), result.length - 1).length
            result.replace(end, result.length, "…")
        }
        return OnScreenLogContent(result, truncated)
    }

    companion object {
        // Also bound old lookups that ignore cancellation across rapid panel replacements.
        private val metadataPermits = Semaphore(2)
        private val neutralIcon: Bitmap by lazy {
            Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).also {
                Canvas(it).drawCircle(16f, 16f, 12f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.GRAY })
            }
        }

        internal fun safePrefix(value: String, limit: Int): String {
            var end = minOf(value.length, limit)
            if (end > 0 && end < value.length && value[end - 1].isHighSurrogate() && value[end].isLowSurrogate()) end--
            return value.substring(0, end)
        }

        internal fun boundedValue(value: String): String = safePrefix(
            value.map { if (Character.getType(it) == Character.CONTROL.toInt()) ' ' else it }.joinToString(""),
            OnScreenLogTemplate.MAX_VALUE_LENGTH,
        )

        @Suppress("DEPRECATION")
        internal fun systemLocale(context: Context): Locale {
            if (Build.VERSION.SDK_INT >= 33) {
                val locales = context.getSystemService(LocaleManager::class.java)?.systemLocales
                if (locales != null && !locales.isEmpty) return locales[0]
            }
            val configuration = Resources.getSystem().configuration
            return if (Build.VERSION.SDK_INT >= 24) configuration.locales[0] else configuration.locale
        }

        @Suppress("DEPRECATION")
        internal fun loadMetadata(context: Context, packageName: String): OnScreenLogAppMetadata {
            val manager = context.packageManager
            val info = runCatching { manager.getPackageInfo(packageName, 0) }.getOrNull()
            val icon = runCatching {
                // Resolve the declared resource ID, including adaptive icons. loadIcon can silently
                // substitute the system default when a declared resource cannot be loaded.
                val application = manager.getApplicationInfo(packageName, 0)
                val drawable = manager.getDrawable(packageName, application.icon, application)
                    ?: return@runCatching null
                Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888).also { bitmap ->
                    drawable.setBounds(0, 0, bitmap.width, bitmap.height)
                    drawable.draw(Canvas(bitmap))
                }
            }.getOrNull()
            return OnScreenLogAppMetadata(
                packageName,
                info?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toString() else it.versionCode.toString() } ?: "Unavailable",
                info?.versionName?.takeIf { it.isNotBlank() } ?: "Unavailable",
                icon,
            )
        }
    }
}

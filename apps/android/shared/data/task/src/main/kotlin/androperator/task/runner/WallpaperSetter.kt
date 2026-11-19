package androperator.task.runner

import action.coroutine.ensureExecutionActive
import android.app.WallpaperManager
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest

class WallpaperSetter(private val context: Context) {
    suspend fun set(action: UiAction.SetWallpaper): Map<String, String> = withContext(Dispatchers.IO) {
        val file = uploadFile(context, action.uploadToken)
        try {
            check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) { "Setting wallpaper requires Android 9 or later" }
            val size = file.length()
            require(size in 1..MAX_BYTES.toLong()) { "Wallpaper image must contain 1 to $MAX_BYTES bytes" }
            val bytes = ByteArray(size.toInt())
            java.io.DataInputStream(file.inputStream().buffered()).use {
                it.readFully(bytes)
                require(it.read() == -1) { "Wallpaper upload grew during validation" }
            }
            val sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            require(sha256 == action.sha256) { "Wallpaper upload checksum mismatch" }
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                val width = info.size.width
                val height = info.size.height
                require(info.mimeType in setOf("image/png", "image/jpeg")) { "Wallpaper image must be a PNG or JPEG" }
                require(width.toLong() * height <= MAX_PIXELS) { "Wallpaper image exceeds 16 megapixels" }
                // Android's cropper can round a very narrow scaled image down to zero pixels.
                require(maxOf(width, height) <= MAX_ASPECT_RATIO * minOf(width, height).toLong()) {
                    "Wallpaper image aspect ratio must be at most 8:1 in either orientation"
                }
                // Verify compressed image data without allocating a full-size bitmap.
                decoder.setTargetSampleSize(4)
            }.recycle()
            val manager = WallpaperManager.getInstance(context)
            check(manager.isWallpaperSupported && manager.isSetWallpaperAllowed) {
                "Android does not allow setting wallpaper for the Operator user"
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                checkLegacyCrop(bytes, manager.desiredMinimumHeight)
            }
            val flags = when (action.target) {
                "home" -> WallpaperManager.FLAG_SYSTEM
                "lock" -> WallpaperManager.FLAG_LOCK
                "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
                else -> error("Unsupported wallpaper target")
            }
            coroutineContext.ensureExecutionActive()
            val appliedId = bytes.inputStream().use { manager.setStream(it, null, false, flags) }
            val homeId = manager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            val lockId = manager.getWallpaperId(WallpaperManager.FLAG_LOCK)
            check(appliedId > 0 && when (action.target) {
                "home" -> homeId == appliedId
                "lock" -> lockId == appliedId
                else -> homeId == appliedId && (lockId < 0 || lockId == appliedId)
            }) { "Android did not confirm the requested wallpaper IDs" }
            mapOf(
                "target" to action.target,
                "wallpaperId" to appliedId.toString(),
                "homeWallpaperId" to homeId.toString(),
                "lockWallpaperId" to lockId.toString(),
            )
        } finally {
            file.delete()
        }
    }

    private fun checkLegacyCrop(bytes: ByteArray, desiredHeight: Int) {
        // Android 9 and 10 scale to this height without a maximum output width.
        // Their cropper uses the encoded axes, even for JPEGs with orientation metadata.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(desiredHeight > 0 && bounds.outWidth > 0 && bounds.outHeight > 0) {
            "Unable to determine wallpaper crop dimensions"
        }
        val heightRatio = bounds.outHeight / desiredHeight
        val sample = Integer.highestOneBit((heightRatio - 1).coerceAtLeast(1))
        val sampledWidth = bounds.outWidth / sample
        val sampledHeight = bounds.outHeight / sample
        val scaledWidthNumerator = sampledWidth.toLong() * desiredHeight
        val maximumWidth = MAX_PIXELS / desiredHeight
        require(scaledWidthNumerator in sampledHeight.toLong()..(maximumWidth * sampledHeight)) {
            "Projected wallpaper crop exceeds Android 9 or 10 size limits"
        }
    }

    companion object {
        private const val MAX_ASPECT_RATIO = 8
        private const val MAX_PIXELS = 16_000_000L
        private const val MAX_BYTES = 8 * 1024 * 1024
        val uploadTokenPattern = Regex("[a-f0-9]{32}")
        val sha256Pattern = Regex("[a-f0-9]{64}")

        fun uploadFile(context: Context, token: String): File {
            require(uploadTokenPattern.matches(token)) { "Invalid wallpaper upload token" }
            return File(context.cacheDir, "wallpaper-$token")
        }
    }
}

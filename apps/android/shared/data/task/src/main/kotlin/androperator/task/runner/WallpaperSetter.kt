package androperator.task.runner

import android.app.WallpaperManager
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

class WallpaperSetter(private val context: Context) {
    suspend fun set(action: UiAction.SetWallpaper): Map<String, String> = withContext(Dispatchers.IO) {
        val file = uploadFile(context, action.uploadToken)
        try {
            check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) { "Setting wallpaper requires Android 7.0 or later" }
            val size = file.length()
            require(size in 1..MAX_BYTES.toLong()) { "Wallpaper image must contain 1 to $MAX_BYTES bytes" }
            val bytes = ByteArray(size.toInt())
            java.io.DataInputStream(file.inputStream().buffered()).use {
                it.readFully(bytes)
                require(it.read() == -1) { "Wallpaper upload grew during validation" }
            }
            val sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            require(sha256 == action.sha256) { "Wallpaper upload checksum mismatch" }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            require(bounds.outMimeType in setOf("image/png", "image/jpeg") && bounds.outWidth > 0 && bounds.outHeight > 0) {
                "Wallpaper image must be a PNG or JPEG"
            }
            val manager = WallpaperManager.getInstance(context)
            check(manager.isWallpaperSupported && manager.isSetWallpaperAllowed) {
                "Android does not allow setting wallpaper for the Operator user"
            }
            val flags = when (action.target) {
                "home" -> WallpaperManager.FLAG_SYSTEM
                "lock" -> WallpaperManager.FLAG_LOCK
                "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
                else -> error("Unsupported wallpaper target")
            }
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

    companion object {
        private const val MAX_BYTES = 8 * 1024 * 1024
        val uploadTokenPattern = Regex("[a-f0-9]{32}")
        val sha256Pattern = Regex("[a-f0-9]{64}")

        fun uploadFile(context: Context, token: String): File {
            require(uploadTokenPattern.matches(token)) { "Invalid wallpaper upload token" }
            return File(context.cacheDir, "wallpaper-$token")
        }
    }
}

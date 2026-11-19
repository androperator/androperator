package androperator.task.runner

import action.coroutine.ensureExecutionActive
import android.app.WallpaperManager
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Point
import android.graphics.RenderNode
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
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
            // Android's cropper uses the encoded axes, including for JPEGs with orientation metadata.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val width = bounds.outWidth
            val height = bounds.outHeight
            require(width > 0 && height > 0) { "Wallpaper image must be a PNG or JPEG" }
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                require(info.mimeType in setOf("image/png", "image/jpeg")) { "Wallpaper image must be a PNG or JPEG" }
                require(info.size.width == width && info.size.height == height) {
                    "Wallpaper orientation metadata swaps the image axes. Rotate the pixels before applying it"
                }
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
            checkPlatformCrop(width, height, manager.desiredMinimumHeight)
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

    @Suppress("DEPRECATION")
    private fun checkPlatformCrop(width: Int, height: Int, desiredHeight: Int) {
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        val screen = Point()
        display?.getRealSize(screen)
        require(screen.x > 0 && screen.y > 0) { "Unable to determine wallpaper display dimensions" }
        val targetHeight = if (desiredHeight > 0) desiredHeight else maxOf(screen.x, screen.y)
        // Android 12 and 13 copy a full-image crop that already fits without upscaling.
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.S..Build.VERSION_CODES.TIRAMISU && height <= targetHeight) {
            val node = RenderNode("Wallpaper bounds")
            val canvas = node.beginRecording(1, 1)
            try {
                if (width <= canvas.maximumBitmapWidth && height <= canvas.maximumBitmapHeight) return
            } finally {
                node.endRecording()
            }
        }
        val widthAtTargetHeight = width.toLong() * targetHeight
        // Android can shorten an image that would otherwise scale narrower than the display.
        val cropHeight =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && widthAtTargetHeight < screen.x.toLong() * height) {
                minOf(height.toLong(), width.toLong() * screen.y / screen.x).toInt()
            } else {
                height
            }
        require(cropHeight > 0) { "Wallpaper image is too small for the Android display crop" }

        // Allow for integer rounding when Android samples the crop at a power of two.
        val sample = Integer.highestOneBit((cropHeight / targetHeight).coerceAtLeast(1))
        val sampledHeight = cropHeight / sample
        val sampledWidth = width / sample
        require(sampledWidth.toLong() * targetHeight >= sampledHeight) {
            "Wallpaper image is too small for the Android display crop"
        }
        val shortestScaledHeight = cropHeight - (sample - 1)
        require(widthAtTargetHeight <= (MAX_PIXELS / targetHeight) * shortestScaledHeight) {
            "Projected wallpaper crop exceeds 16 megapixels"
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

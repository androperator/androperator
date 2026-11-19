package androperator.task.runner

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

/** ADB streams one image into the Operator's private cache before dispatch. */
class WallpaperUploadProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    private fun upload(uri: Uri): File {
        val token = uri.pathSegments.singleOrNull() ?: throw FileNotFoundException()
        return WallpaperSetter.uploadFile(requireNotNull(context), token)
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "w") throw FileNotFoundException("Wallpaper uploads are write-only")
        return ParcelFileDescriptor.open(
            upload(uri),
            ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE,
        )
    }

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
        if (upload(uri).delete()) 1 else 0

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? =
        throw UnsupportedOperationException()

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int =
        throw UnsupportedOperationException()

    override fun getType(uri: Uri): String? = null
}

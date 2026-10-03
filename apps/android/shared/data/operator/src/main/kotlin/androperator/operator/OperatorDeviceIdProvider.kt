package androperator.operator

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.core.content.edit
import java.security.MessageDigest
import java.util.UUID

interface OperatorDeviceIdProvider {
    suspend fun getId(): String
}

class OperatorDeviceIdProviderAndroid(
    private val context: Context,
) : OperatorDeviceIdProvider {
    @SuppressLint("HardwareIds")
    override suspend fun getId(): String {
        val androidId =
            Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ANDROID_ID,
            ) ?: cachedOrNewFallbackId(context) // generate & persist a UUID once

        val deviceData = "${Build.BRAND}:${Build.MODEL}:${Build.DEVICE}:$androidId"
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(deviceData.toByteArray(Charsets.UTF_8))
        return hash.take(16).joinToString("") { "%02x".format(it) }
    }

    private fun cachedOrNewFallbackId(ctx: Context): String {
        val prefs = ctx.getSharedPreferences("operator", Context.MODE_PRIVATE)
        return prefs.getString("fallback_id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit {
                putString("fallback_id", it)
            }
        }
    }
}

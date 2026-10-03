package androperator.openapp

import action.activity.StartActivityHelper
import action.system.toast.ToastDisplayController
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

interface OpenAppManager {
    fun open(data: OpenAppData)
}

class OpenAppManagerAndroid(
    private val context: Context,
    private val startActivityHelper: StartActivityHelper,
    private val toastDisplayController: ToastDisplayController,
) : OpenAppManager {
    override fun open(data: OpenAppData) {
        val intent = data.mapToIntent()
        if (!openActivity(intent)) {
            data.applicationId?.also { applicationId ->
                openApp(applicationId)
            }
        }
    }

    private fun openActivity(intent: Intent): Boolean =
        try {
            startActivityHelper.startActivity(intent)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        } catch (e: Exception) {
            false
        }

    private fun openApp(applicationId: String) {
        val packageManager = context.packageManager
        try {
            val intent = packageManager.getLaunchIntentForPackage(applicationId)
            if (intent != null) {
                startActivityHelper.startActivity(intent)
            } else {
                toastDisplayController.showToast("App not found")
            }
        } catch (e: PackageManager.NameNotFoundException) {
            toastDisplayController.showToast("App not installed or invalid package ID")
        }
    }
}

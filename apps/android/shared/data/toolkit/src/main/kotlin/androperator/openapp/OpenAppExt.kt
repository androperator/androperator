package androperator.openapp

import action.devicepackage.asComponentName
import action.resource.intent
import android.content.Intent
import androidx.core.net.toUri

fun OpenAppData.mapToIntent(): Intent =
    when (this) {
        is OpenAppData.Uri -> {
            Intent(Intent.ACTION_VIEW).apply {
                this.data = uri.toUri()
                applicationId?.let {
                    this.`package` = applicationId
                }
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
        }
        is OpenAppData.Intent -> {
            this.intentKey.intent.apply {
                require(this.`package` == null || this.`package` == applicationId) {
                    "Intent package does not match OpenAppData applicationId."
                }
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
        }
        is OpenAppData.Component -> {
            Intent(Intent.ACTION_MAIN).apply {
                this.component = componentKey.asComponentName()
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
        }
    }

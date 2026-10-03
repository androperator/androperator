package androperator.operator.toast

import android.content.Context
import android.widget.Toast
import androperator.task.runner.ApiToastController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ApiToastControllerAndroid(context: Context) : ApiToastController {
    private val applicationContext = context.applicationContext
    private var currentToast: Toast? = null

    override suspend fun show(text: String, duration: String) {
        withContext(Dispatchers.Main.immediate) {
            val nativeDuration = when (duration) {
                "short" -> Toast.LENGTH_SHORT
                "long" -> Toast.LENGTH_LONG
                else -> error("Toast duration must be short or long")
            }
            val toast = Toast.makeText(applicationContext, text, nativeDuration)
            currentToast?.cancel()
            currentToast = toast
            toast.show()
        }
    }

    override suspend fun cancel() {
        withContext(Dispatchers.Main.immediate) {
            currentToast?.cancel()
            currentToast = null
        }
    }
}

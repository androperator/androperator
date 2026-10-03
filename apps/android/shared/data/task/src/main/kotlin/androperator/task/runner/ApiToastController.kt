package androperator.task.runner

/** Owns only API-requested toasts, independently of incidental Operator messages. */
interface ApiToastController {
    suspend fun show(text: String, duration: String)
    suspend fun cancel()
}

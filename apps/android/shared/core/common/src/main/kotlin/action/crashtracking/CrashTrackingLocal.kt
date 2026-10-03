package action.crashtracking

import action.annotation.CheckResult
import action.log.Log

class CrashTrackingLocal : CrashTracking {
    init {
        Log.d("%s, Initialising", this::class.simpleName)
    }

    @CheckResult override fun logFatalException(
        exception: Exception,
        message: String,
    ): Exception {
        LocalCrashLog.logWarning(message, exception)
        Log.w(message)
        Log.e(exception, exception.message)
        throw exception
    }

    override fun logNonFatalException(exception: Exception) {
        LocalCrashLog.logWarning("Non-fatal exception", exception)
        Log.w(exception, exception.message)
    }

    override fun log(
        message: String,
        logToConsole: Boolean,
    ) {
        LocalCrashLog.logInfo(message)
        if (logToConsole) Log.i(message)
    }
}

package action.crashtracking

object CrashTrackingHolder {
    private var _crashTracking: CrashTracking? = null
    val crashTracking: CrashTracking
        get() {
            if (_crashTracking == null) {
                initialize(CrashTrackingLocal())
            }
            return _crashTracking!!
        }

    fun initialize(crashTracking: CrashTracking) {
        _crashTracking = crashTracking
    }
}

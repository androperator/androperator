package androperator.operator.command

import action.log.Log
import action.system.toast.ToastDisplayController

class OperatorCommandStatusReporterDefault(
    private val toastDisplayController: ToastDisplayController,
) : OperatorCommandStatusReporter {
    override fun info(message: String) = Log.i("[OperatorCmd] $message")

    override fun warn(message: String) = Log.w("[OperatorCmd] $message")

    override fun error(
        message: String,
        throwable: Throwable?,
    ) = Log.e(throwable, "[OperatorCmd] $message")

    override fun notifyUser(message: String) = toastDisplayController.showToast(message)
}

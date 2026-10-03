package androperator.operator.command

interface OperatorCommandStatusReporter {
    fun info(message: String)

    fun warn(message: String)

    fun error(
        message: String,
        throwable: Throwable? = null,
    )

    fun notifyUser(message: String)
}

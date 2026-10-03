package action.process

open class ProcessMock(
    override val isDefaultProcess: Boolean = true,
    override val isTestProcess: Boolean = false,
    override val processName: String = "com.androperator.operator",
    override val processNameSuffix: String? = null,
) : Process {
    constructor(isDefaultProcess: Boolean, processName: String) : this(
        isDefaultProcess = isDefaultProcess,
        isTestProcess = false,
        processName = processName,
        processNameSuffix = extractProcessSuffix(processName),
    )
}

class ProcessMockDefault :
    ProcessMock(
        isDefaultProcess = true,
        processNameSuffix = null,
        isTestProcess = false,
    )

class ProcessMockLiveWallpaper :
    ProcessMock(
        isDefaultProcess = false,
        processNameSuffix = ":livewallpaper",
    )

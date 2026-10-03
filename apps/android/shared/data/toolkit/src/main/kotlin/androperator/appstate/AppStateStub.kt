package androperator.appstate

import action.time.TimeRepositoryMock
import androperator.prefs.DevicePreferenceStorageStub

class AppStateStub(
    devicePreferenceStorage: DevicePreferenceStorageStub = DevicePreferenceStorageStub(),
    timeRepository: TimeRepositoryMock = TimeRepositoryMock(),
) : AppStateMainProcess(devicePreferenceStorage, timeRepository)

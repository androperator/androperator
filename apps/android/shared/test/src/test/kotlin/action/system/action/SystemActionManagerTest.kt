package action.system.action

import action.system.accessibility.SystemAccessibilityActionType
import action.system.accessibility.SystemAccessibilityServiceManagerMock
import androperator.test.ActionTest
import androperator.test.actionTest
import kotlinx.coroutines.launch
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SystemActionManagerTest : ActionTest {
    @Test
    fun `when startBackgroundRequest is called then onStartBackgroundRequest is called`() =
        actionTest {
            var onStartBackgroundRequestCalled = false
            val onStartBackgroundRequest: (SystemAccessibilityActionType) -> Unit = {
                onStartBackgroundRequestCalled = true
            }
            val serviceManager = SystemAccessibilityServiceManagerMock(onStartBackgroundRequest)
            val systemActionManager = SystemActionManagerDefault(serviceManager)

            systemActionManager.startBackgroundRequest(SystemAccessibilityActionType.OpenNotificationPanel)

            assertTrue(onStartBackgroundRequestCalled)
        }

    @Test
    fun `openNotificationPanel emits pending and result states`() =
        actionTest {
            val onStartBackgroundRequest: (SystemAccessibilityActionType) -> Unit = {
//            onStartBackgroundRequestCalled = true
            }
            val serviceManager = SystemAccessibilityServiceManagerMock(onStartBackgroundRequest)
            val systemActionManager = SystemActionManagerDefault(serviceManager)

            // Start collecting the flow
            val states = mutableListOf<SystemActionState>()
            val job =
                launch {
                    systemActionManager.openNotificationPanel().collect { state ->
                        states.add(state)
                    }
                }

            // Wait for the initial state to be collected
            while (states.isEmpty()) {
                kotlinx.coroutines.yield()
            }

            // Verify initial pending state
            assertEquals(SystemActionState.Pending, states[0])

            // Simulate the result coming back
            systemActionManager.setActionResult(SystemAccessibilityActionType.OpenNotificationPanel, SystemActionState.Result.Success)

            // Wait for the second state to be collected
            while (states.size < 2) {
                kotlinx.coroutines.yield()
            }

            // Verify both states were emitted in correct order
            assertEquals(2, states.size)
            assertEquals(SystemActionState.Pending, states[0])
            assertEquals(SystemActionState.Result.Success, states[1])

            job.cancel() // Clean up
        }
}

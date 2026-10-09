package androperator.operator.agent

import androperator.task.runner.UiAction
import androperator.task.runner.UiSystemKey
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AgentCommandParserTvRemoteTest {
    private fun parse(key: String) = AgentCommandParserDefault().parse(
        """{"commandId":"tv-command","taskId":"tv-task","source":"test","actions":[{"id":"button","type":"press_key","params":{"key":"$key"}}]}""",
    )

    @Test
    fun `all system TV and Automotive buttons parse case insensitively`() {
        UiSystemKey.entries.forEach { key ->
            val action = parse(key.name).getOrThrow().actions.single() as UiAction.PressKey
            assertEquals(key, action.key)
            assertEquals("button", action.id)
        }
    }

    @Test
    fun `missing blank and unsupported buttons fail`() {
        listOf("", " ", "profile_switch", "KEYCODE_TV").forEach { key ->
            assertTrue(parse(key).isFailure, key)
        }
        assertTrue(AgentCommandParserDefault().parse(
            """{"commandId":"tv-command","taskId":"tv-task","source":"test","actions":[{"id":"button","type":"press_key"}]}""",
        ).isFailure)
    }
}

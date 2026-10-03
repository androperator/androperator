package androperator.operator.agent

import androperator.task.runner.UiAction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentCommandParserToastTest {
    private val parser = AgentCommandParserDefault()

    private fun parse(type: String, params: String? = null) = parser.parse(
        """{"commandId":"toast-command","taskId":"toast-task","source":"test","actions":[{"id":"a1","type":"$type"${params?.let { ",\"params\":$it" } ?: ""}}]}""",
    )

    @Test
    fun `show preserves text and defaults duration to short`() {
        val action = assertIs<UiAction.ShowToast>(parse("show_toast", """{"text":" started "}""").getOrThrow().actions.single())
        assertEquals(" started ", action.text)
        assertEquals("short", action.duration)
        for (duration in listOf("short", "long")) {
            assertEquals(duration, assertIs<UiAction.ShowToast>(parse("show_toast", """{"text":"x","duration":"$duration"}""").getOrThrow().actions.single()).duration)
        }
        assertTrue(parse("show_toast", """{"text":"${"x".repeat(2048)}"}""").isSuccess)
    }

    @Test
    fun `show rejects missing blank malformed and unknown fields`() {
        for (params in listOf(null, "null", "[]", "{}", """{"text":null}""", """{"text":12}""", """{"text":""}""",
            """{"text":" \t\n\uFEFF"}""", """{"text":"${"x".repeat(2049)}"}""", """{"text":"x","duration":null}""",
            """{"text":"x","duration":""}""", """{"text":"x","duration":"LONG"}""", """{"text":"x","duration":2000}""",
            """{"text":"x","durationMs":2000}""", """{"text":"x","retry":{}}""", """{"value":"alias"}""")) {
            assertTrue(parse("show_toast", params).isFailure, params)
        }
    }

    @Test
    fun `cancel accepts omitted or empty params only`() {
        for (params in listOf(null, "{}")) assertIs<UiAction.CancelToast>(parse("cancel_toast", params).getOrThrow().actions.single())
        for (params in listOf("null", "[]", "\"\"", """{"text":"x"}""", """{"duration":"short"}""")) {
            assertTrue(parse("cancel_toast", params).isFailure, params)
        }
    }
}

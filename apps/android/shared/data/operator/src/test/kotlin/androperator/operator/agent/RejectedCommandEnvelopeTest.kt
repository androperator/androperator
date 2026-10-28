package androperator.operator.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class RejectedCommandEnvelopeTest {
    private fun envelope(line: String) = Json.parseToJsonElement(line.removePrefix("$ANDROPERATOR_RESULT_PREFIX ")).jsonObject

    @Test
    fun `a payload the parser rejects becomes a failed envelope with its ids and the reason`() {
        val payload = """{"commandId":"drag-1","taskId":"task-1","source":"x","actions":[{"id":"d","type":"drag","params":{}}]}"""
        val error = AgentCommandParserDefault().parse(payload).exceptionOrNull()
        assertNotNull(error)
        val line = assertNotNull(buildRejectedCommandLine(payload, error))
        assertTrue(line.startsWith(ANDROPERATOR_RESULT_PREFIX))
        val parsed = envelope(line)
        assertEquals("drag-1", parsed["commandId"]?.jsonPrimitive?.content)
        assertEquals("task-1", parsed["taskId"]?.jsonPrimitive?.content)
        assertEquals("failed", parsed["status"]?.jsonPrimitive?.content)
        assertEquals(EnvelopeErrorCodes.COMMAND_REJECTED, parsed["errorCode"]?.jsonPrimitive?.content)
        assertTrue(parsed["error"]?.jsonPrimitive?.content?.startsWith("Command rejected: ") == true)
    }

    @Test
    fun `a missing task id falls back to the command id`() {
        val line = assertNotNull(buildRejectedCommandLine("""{"commandId":"only"}""", IllegalArgumentException("bad")))
        assertEquals("only", envelope(line)["taskId"]?.jsonPrimitive?.content)
    }

    @Test
    fun `a payload without a readable command id has no envelope to correlate`() {
        for (payload in listOf("not json", "[]", """{"taskId":"t"}""", """{"commandId":7}""", """{"commandId":""}""")) {
            assertNull(buildRejectedCommandLine(payload, IllegalArgumentException("bad")), payload)
        }
    }
}

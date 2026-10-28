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

    @Test
    fun `an oversized parser message is bounded so the envelope fits one log record`() {
        val line = assertNotNull(buildRejectedCommandLine("""{"commandId":"big"}""", IllegalArgumentException("x".repeat(5000))))
        assertTrue(line.toByteArray().size < 1000, "envelope is ${line.length} chars")
        val reason = envelope(line)["error"]?.jsonPrimitive?.content.orEmpty()
        assertTrue(reason.startsWith("Command rejected: xxx"))
        assertTrue(reason.endsWith("..."))
    }

    @Test
    fun `ids that could overflow one log record are not echoed`() {
        val long = "i".repeat(MAX_REJECTION_ID_CHARS + 1)
        assertNull(buildRejectedCommandLine("""{"commandId":"$long"}""", IllegalArgumentException("bad")))
        assertNull(buildRejectedCommandLine("""{"commandId":"ok","taskId":"$long"}""", IllegalArgumentException("bad")))
        val limit = "i".repeat(MAX_REJECTION_ID_CHARS)
        val line = assertNotNull(buildRejectedCommandLine("""{"commandId":"$limit","taskId":"$limit"}""", IllegalArgumentException("x".repeat(5000))))
        assertTrue(line.toByteArray().size < 1500, "envelope is ${line.length} chars")
    }

    @Test
    fun `bounding never splits a surrogate pair`() {
        val message = "a".repeat(MAX_REJECTION_REASON_CHARS - 1) + "\uD83D\uDE00" + "tail"
        val line = assertNotNull(buildRejectedCommandLine("""{"commandId":"emoji"}""", IllegalArgumentException(message)))
        val reason = envelope(line)["error"]?.jsonPrimitive?.content.orEmpty()
        assertTrue(reason.none { it.isHighSurrogate() && !reason.getOrNull(reason.indexOf(it) + 1).let { next -> next != null && next.isLowSurrogate() } })
    }
}

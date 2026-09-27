package clawperator.operator.agent

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DirectResultProtocolTest {
    private fun controls(session: String = "session"): DataInputStream {
        val bytes = ByteArrayOutputStream()
        val output = DataOutputStream(bytes)
        for (type in listOf("ping", "ack")) {
            val control = """{"type":"$type","sessionId":"$session"}""".encodeToByteArray()
            output.writeInt(control.size)
            output.write(control)
        }
        return DataInputStream(ByteArrayInputStream(bytes.toByteArray()))
    }

    @Test
    fun `large Unicode canonical result is intact and timing measures local send through acknowledgement`() {
        val canonical = "[Clawperator-Result] " + "界😀".repeat(300_000)
        val bytes = ByteArrayOutputStream()
        var ready = false
        var time = 0L
        DirectResultProtocol("session", "command", "task", "test.operator") {
            time += 2_000_000
            time
        }.serve(
            controls(),
            DataOutputStream(bytes),
            { ready = true },
            {
                assertTrue(ready)
                canonical
            },
        )
        val input = DataInputStream(ByteArrayInputStream(bytes.toByteArray()))
        fun frame(): ByteArray = ByteArray(input.readInt()).also { input.readFully(it) }
        fun control() = Json.parseToJsonElement(frame().decodeToString()).jsonObject
        val hello = control()
        assertEquals("command", hello.getValue("commandId").jsonPrimitive.content)
        assertEquals("task", hello.getValue("taskId").jsonPrimitive.content)
        assertEquals("test.operator", hello.getValue("operatorPackage").jsonPrimitive.content)
        assertEquals("pong", control().getValue("type").jsonPrimitive.content)
        val header = control()
        val result = frame()
        assertEquals(canonical, result.decodeToString())
        assertEquals(result.size, header.getValue("byteLength").jsonPrimitive.int)
        assertEquals(
            MessageDigest.getInstance("SHA-256").digest(result).joinToString("") { "%02x".format(it) },
            header.getValue("sha256").jsonPrimitive.content,
        )
        val timing = control()
        assertEquals(2.0, timing.getValue("androidResultWriteMs").jsonPrimitive.double)
        assertEquals(4.0, timing.getValue("androidResultAckRoundTripMs").jsonPrimitive.double)
        assertEquals(0, input.available())
    }

    @Test
    fun `wrong session never makes the endpoint ready or consumes a result`() {
        var ready = false
        assertFailsWith<IllegalArgumentException> {
            DirectResultProtocol("session", "command", "task", "test.operator").serve(
                controls("wrong"),
                DataOutputStream(ByteArrayOutputStream()),
                { ready = true },
                { error("must not consume") },
            )
        }
        assertFalse(ready)
    }

    @Test
    fun `oversized control frame is rejected before reading its payload`() {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).writeInt(Int.MAX_VALUE)
        assertFailsWith<IllegalArgumentException> {
            DirectResultProtocol("session", "command", "task", "test.operator").serve(
                DataInputStream(ByteArrayInputStream(bytes.toByteArray())),
                DataOutputStream(ByteArrayOutputStream()),
                { error("must not become ready") },
                { error("must not consume") },
            )
        }
    }
}

package clawperator.operator.agent

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.MessageDigest

/** Length-prefixed UTF-8 controls and an unchanged canonical result, all on one ordered stream. */
internal class DirectResultProtocol(
    private val sessionId: String,
    private val commandId: String,
    private val taskId: String,
    private val operatorPackage: String,
    private val nanoTime: () -> Long = System::nanoTime,
) {
    fun serve(
        input: DataInputStream,
        output: DataOutputStream,
        onReady: () -> Unit,
        result: () -> String,
    ) {
        fun frame(bytes: ByteArray) {
            output.writeInt(bytes.size)
            output.write(bytes)
            output.flush()
        }
        fun control(value: JsonObject) = frame(value.toString().encodeToByteArray())
        fun readControl(type: String) {
            val length = input.readInt()
            require(length in 1..4096)
            val bytes = ByteArray(length)
            input.readFully(bytes)
            val value = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
            require(
                value.getValue("type").jsonPrimitive.content == type &&
                    value.getValue("sessionId").jsonPrimitive.content == sessionId,
            )
        }
        control(
            buildJsonObject {
                put("type", "ready")
                put("protocol", 1)
                put("sessionId", sessionId)
                put("commandId", commandId)
                put("taskId", taskId)
                put("operatorPackage", operatorPackage)
            },
        )
        readControl("ping")
        onReady()
        control(buildJsonObject { put("type", "pong") })
        val bytes = result().encodeToByteArray()
        require(bytes.size in 1..32 * 1024 * 1024)
        val checksum = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val header = buildJsonObject {
            put("type", "result")
            put("sessionId", sessionId)
            put("commandId", commandId)
            put("taskId", taskId)
            put("byteLength", bytes.size)
            put("sha256", checksum)
        }
        val sendStarted = nanoTime()
        control(header)
        frame(bytes)
        val writeMs = (nanoTime() - sendStarted) / 1_000_000.0
        readControl("ack")
        val ackMs = (nanoTime() - sendStarted) / 1_000_000.0
        control(
            buildJsonObject {
                put("type", "timing")
                put("androidResultWriteMs", writeMs)
                put("androidResultAckRoundTripMs", ackMs)
            },
        )
    }
}

package androperator.operator.agent

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** Logcat cannot carry a large query envelope in one record. Reassemble before parsing the canonical envelope. */
@OptIn(ExperimentalEncodingApi::class)
fun resultEnvelopeLogLines(
    canonicalLine: String,
    commandId: String,
    taskId: String,
): List<String> {
    val bytes = canonicalLine.encodeToByteArray()
    if (bytes.size <= 3000) return listOf(canonicalLine)
    val chunkBytes = 1024
    val count = (bytes.size + chunkBytes - 1) / chunkBytes
    val sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    return (0 until count).map { index ->
        val data = Base64.encode(bytes.copyOfRange(index * chunkBytes, minOf((index + 1) * chunkBytes, bytes.size)))
        "[Androperator-Result-Chunk] " + Json.encodeToString(ResultEnvelopeChunk(commandId, taskId, index, count, bytes.size, sha256, data))
    }
}

@Serializable
private data class ResultEnvelopeChunk(
    val commandId: String,
    val taskId: String,
    val index: Int,
    val count: Int,
    val byteLength: Int,
    val sha256: String,
    val data: String,
)

/**
 * Give logd time to drain between records. Android's nonblocking logger can drop
 * a burst of chunks while its public write API still reports success.
 * Await publication off the caller thread, even when the command is cancelled.
 */
internal suspend fun publishResultEnvelope(
    canonicalLine: String,
    commandId: String,
    taskId: String,
    writeLine: (String) -> Unit = { action.log.Log.i(it) },
    pause: suspend () -> Unit = { delay(1) },
    writeDiagnostic: (String) -> Unit = { action.log.Log.i(it) },
) = withContext(NonCancellable + Dispatchers.IO) {
    val started = System.nanoTime()
    val lines = resultEnvelopeLogLines(canonicalLine, commandId, taskId)
    val byteLength = canonicalLine.encodeToByteArray().size
    var writtenRecords = 0
    fun record(event: String) {
        try {
            writeDiagnostic(
                "[Androperator-Publication] " + Json.encodeToString(
                    ResultPublicationEvent(
                        commandId, taskId, event, byteLength, lines.size,
                        if (lines.size > 1) lines.size else 0,
                        writtenRecords, (System.nanoTime() - started) / 1_000_000,
                    ),
                ),
            )
        } catch (_: Exception) {
            // Diagnostic failures cannot prevent or replace canonical publication.
        }
    }
    record("started")
    try {
        lines.forEachIndexed { index, line ->
            if (index > 0) pause()
            writeLine(line)
            writtenRecords++
        }
        // Logger writes returning is not an acknowledgement from a host reader.
        record("writes_completed")
    } catch (error: Exception) {
        record("write_failed")
        throw error
    }
}


@Serializable
private data class ResultPublicationEvent(
    val commandId: String,
    val taskId: String,
    val event: String,
    val byteLength: Int,
    val recordCount: Int,
    val chunkCount: Int,
    val writtenRecords: Int,
    val elapsedMs: Long,
)

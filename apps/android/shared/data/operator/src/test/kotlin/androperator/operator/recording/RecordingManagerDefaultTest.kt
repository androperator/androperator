package androperator.operator.recording

import action.buildconfig.BuildConfigMock
import action.environment.EnvironmentMock
import android.app.Application
import androperator.task.runner.ERROR_RECORDING_ALREADY_IN_PROGRESS
import androperator.task.runner.ERROR_RECORDING_NOT_IN_PROGRESS
import androperator.task.runner.RecordingCommandOutcome
import kotlinx.coroutines.test.runTest
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.BufferedWriter
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.assertFalse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class)
class RecordingManagerDefaultTest {
    private fun createManager(directory: String = "/tmp/androperator-recording-manager-test"): RecordingManagerDefault {
        val buildConfig =
            BuildConfigMock().apply {
                _packageName = "com.androperator.operator.dev"
            }
        return RecordingManagerDefault(
            environment = EnvironmentMock(directory),
            buildConfig = buildConfig,
        )
    }

    @Test
    fun `start recording while already active returns already in progress error`() = runTest {
        val manager = createManager()

        val started = manager.startRecording("demo-001")
        val duplicate = manager.startRecording("demo-002")

        assertIs<RecordingCommandOutcome.Started>(started)
        val error = assertIs<RecordingCommandOutcome.Error>(duplicate)
        assertEquals(ERROR_RECORDING_ALREADY_IN_PROGRESS, error.code)
        assertEquals("demo-001", error.sessionId)
    }

    @Test
    fun `stop recording while idle returns not in progress error`() = runTest {
        val manager = createManager()

        val result = manager.stopRecording(null)

        val error = assertIs<RecordingCommandOutcome.Error>(result)
        assertEquals(ERROR_RECORDING_NOT_IN_PROGRESS, error.code)
    }

    @Test
    fun `stop recording returns event count and latest pointer after queued event`() = runTest {
        val directory = "/tmp/androperator-recording-manager-success"
        val manager = createManager(directory)

        val started = assertIs<RecordingCommandOutcome.Started>(manager.startRecording("demo-003"))
        val enqueued =
            manager.enqueueEvent { seq ->
                RecordingPressKeyEvent(
                    ts = 123L,
                    seq = seq,
                    key = "back",
                    snapshot = "<hierarchy/>",
                )
            }
        val stopped = manager.stopRecording("demo-003")

        assertTrue(enqueued)
        val result = assertIs<RecordingCommandOutcome.Stopped>(stopped)
        assertEquals("demo-003", result.sessionId)
        assertEquals(1, result.eventCount)
        assertEquals(started.filePath, result.filePath)

        val latestFile = java.io.File(directory).resolve("recordings/latest")
        assertTrue(latestFile.exists())
        assertEquals("demo-003", latestFile.readText())
        val ndjsonFile = java.io.File(result.filePath)
        assertTrue(ndjsonFile.exists())
        val lines = ndjsonFile.readLines()
        assertEquals(2, lines.size)
        assertTrue(lines.first().contains("\"type\":\"recording_header\""))
        assertTrue(lines.last().contains("\"type\":\"press_key\""))
    }

    @Test
    fun `stop recording with no events succeeds with zero event count`() = runTest {
        val manager = createManager("/tmp/androperator-recording-manager-empty")

        val started = assertIs<RecordingCommandOutcome.Started>(manager.startRecording("demo-empty"))
        val stopped = manager.stopRecording("demo-empty")

        val result = assertIs<RecordingCommandOutcome.Stopped>(stopped)
        assertEquals("demo-empty", result.sessionId)
        assertEquals(0, result.eventCount)
        assertEquals(started.filePath, result.filePath)
    }

    @Test
    fun `start recording rejects session ids with path separators`() = runTest {
        val directory = "/tmp/androperator-recording-manager-invalid-session"
        val manager = createManager(directory)

        val result = manager.startRecording("../evil")

        val error = assertIs<RecordingCommandOutcome.Error>(result)
        assertEquals("RECORDING_START_FAILED", error.code)
        assertTrue(error.message.contains("letters, numbers, hyphens, or underscores"))
        assertFalse(java.io.File(directory).resolve("evil.ndjson").exists())
        assertTrue(java.io.File(directory).resolve("recordings").exists())
    }

    @Test
    fun `is safe session id accepts plain identifiers`() {
        assertTrue(isSafeSessionId("demo-001"))
        assertTrue(isSafeSessionId("record-20260319-acde1234"))
        assertTrue(isSafeSessionId("demo_001"))
    }

    @Test
    fun `is safe session id rejects path traversal and separators`() {
        assertFalse(isSafeSessionId("."))
        assertFalse(isSafeSessionId(".."))
        assertFalse(isSafeSessionId("../evil"))
        assertFalse(isSafeSessionId("nested/evil"))
        assertFalse(isSafeSessionId("nested\\evil"))
        assertFalse(isSafeSessionId("session\nevil"))
    }

    @Test
    fun `drain flag resets after a writer failure`() = runTest {
        val manager = createManager("/tmp/androperator-recording-manager-drain-failure")

        assertIs<RecordingCommandOutcome.Started>(manager.startRecording("demo-drain"))
        val session = manager.readActiveSession()
        val writer = session.readField<BufferedWriter>("writer")
        writer.close()

        assertTrue(
            manager.enqueueEvent { seq ->
                RecordingPressKeyEvent(
                    ts = 456L,
                    seq = seq,
                    key = "back",
                    snapshot = "<hierarchy/>",
                )
            },
        )

        val stopped = manager.stopRecording("demo-drain")
        assertIs<RecordingCommandOutcome.Error>(stopped)
        assertFalse(session.readField<AtomicBoolean>("drainScheduled").get())
    }

    private fun RecordingManagerDefault.readActiveSession(): Any =
        readField("activeSession")

    private fun <T> Any.readField(name: String): T {
        val field = this::class.java.getDeclaredField(name)
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        return field.get(this) as T
    }
}

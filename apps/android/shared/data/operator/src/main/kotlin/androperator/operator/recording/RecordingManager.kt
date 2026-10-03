package androperator.operator.recording

import action.buildconfig.BuildConfig
import action.environment.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import androperator.task.runner.ERROR_RECORDING_ALREADY_IN_PROGRESS
import androperator.task.runner.ERROR_RECORDING_NOT_IN_PROGRESS
import androperator.task.runner.RecordingCommandOutcome
import androperator.task.runner.RecordingManager
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface RecordingEventSink {
    fun isRecordingActive(): Boolean

    fun enqueueEvent(eventBuilder: (seq: Long) -> RecordingEvent): Boolean
}

class RecordingManagerDefault(
    private val environment: Environment,
    private val buildConfig: BuildConfig,
) : RecordingManager, RecordingEventSink {
    private val stateLock = Any()

    @Volatile
    private var activeSession: ActiveRecordingSession? = null

    override suspend fun startRecording(sessionId: String?): RecordingCommandOutcome =
        synchronized(stateLock) {
            val currentSession = activeSession
            if (currentSession != null) {
                return@synchronized RecordingCommandOutcome.Error(
                    code = ERROR_RECORDING_ALREADY_IN_PROGRESS,
                    message = "Recording is already in progress",
                    sessionId = currentSession.sessionId,
                    filePath = currentSession.file.absolutePath,
                )
            }

            val recordingsDirectory = environment.externalFilesDirectory?.resolve(RECORDINGS_DIR_NAME)
            if (recordingsDirectory == null) {
                return@synchronized RecordingCommandOutcome.Error(
                    code = "RECORDING_STORAGE_UNAVAILABLE",
                    message = "External files directory is not available",
                )
            }
            if (!recordingsDirectory.exists() && !recordingsDirectory.mkdirs()) {
                return@synchronized RecordingCommandOutcome.Error(
                    code = "RECORDING_STORAGE_UNAVAILABLE",
                    message = "Failed to create recordings directory: ${recordingsDirectory.absolutePath}",
                )
            }

            val resolvedSessionId = sessionId?.takeIf { it.isNotBlank() } ?: generateSessionId()
            if (!isSafeSessionId(resolvedSessionId)) {
                return@synchronized RecordingCommandOutcome.Error(
                    code = "RECORDING_START_FAILED",
                    message = "sessionId must use only letters, numbers, hyphens, or underscores",
                )
            }
            val outputFile = recordingsDirectory.resolve("$resolvedSessionId.ndjson")

            return@synchronized try {
                val writer = BufferedWriter(FileWriter(outputFile, false))
                val header =
                    RecordingHeader(
                        schemaVersion = SCHEMA_VERSION,
                        sessionId = resolvedSessionId,
                        startedAt = System.currentTimeMillis(),
                        operatorPackage = buildConfig.packageName,
                    )
                writer.write(recordingJson.encodeToString(header))
                writer.newLine()
                writer.flush()

                val writerThread = HandlerThread("RecordingWriterThread-$resolvedSessionId").apply { start() }
                val session =
                    ActiveRecordingSession(
                        sessionId = resolvedSessionId,
                        file = outputFile,
                        recordingsDirectory = recordingsDirectory,
                        writer = writer,
                        writerThread = writerThread,
                        handler = Handler(writerThread.looper),
                    )
                activeSession = session
                Log.i(LOG_TAG, "SESSION_STARTED sessionId=$resolvedSessionId file=${outputFile.absolutePath}")
                RecordingCommandOutcome.Started(
                    sessionId = resolvedSessionId,
                    filePath = outputFile.absolutePath,
                )
            } catch (t: Throwable) {
                RecordingCommandOutcome.Error(
                    code = "RECORDING_START_FAILED",
                    message = t.message ?: "Failed to start recording",
                )
            }
        }

    override suspend fun stopRecording(sessionId: String?): RecordingCommandOutcome {
        val session =
            synchronized(stateLock) {
                val currentSession = activeSession
                    ?: return RecordingCommandOutcome.Error(
                        code = ERROR_RECORDING_NOT_IN_PROGRESS,
                        message = "Recording is not in progress",
                    )
                activeSession = null
                currentSession
            }

        if (sessionId != null && sessionId != session.sessionId) {
            Log.w(
                LOG_TAG,
                "SESSION_ID_MISMATCH stopRequestedSessionId=$sessionId activeSessionId=${session.sessionId}",
            )
        }

        val latch = CountDownLatch(1)
        val resultRef = arrayOfNulls<RecordingCommandOutcome>(1)
        session.handler.post {
            resultRef[0] = finalizeSession(session)
            latch.countDown()
        }

        latch.await(FINALIZE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        return resultRef[0]
            ?: RecordingCommandOutcome.Error(
                code = "RECORDING_STOP_FAILED",
                message = "Timed out while finalizing recording",
                sessionId = sessionId ?: session.sessionId,
                filePath = session.file.absolutePath,
            )
    }

    override fun isRecordingActive(): Boolean = activeSession != null

    override fun enqueueEvent(eventBuilder: (seq: Long) -> RecordingEvent): Boolean {
        val session = activeSession ?: return false
        val event = eventBuilder(session.nextSequence.getAndIncrement())
        session.queue.add(event)
        scheduleDrain(session)
        return true
    }

    private fun scheduleDrain(session: ActiveRecordingSession) {
        if (session.drainScheduled.compareAndSet(false, true)) {
            session.handler.post {
                try {
                    drainQueue(session)
                } catch (t: Throwable) {
                    Log.e(LOG_TAG, "QUEUE_DRAIN_FAILED sessionId=${session.sessionId}", t)
                }
            }
        }
    }

    private fun drainQueue(session: ActiveRecordingSession) {
        try {
            do {
                var drainedCount = 0
                while (true) {
                    val event = session.queue.peek() ?: break
                    session.writer.write(serializeEvent(event))
                    session.writer.newLine()
                    session.queue.poll()
                    session.writtenEventCount.incrementAndGet()
                    drainedCount++
                }
                if (drainedCount > 0) {
                    session.writer.flush()
                }
                session.drainScheduled.set(false)
            } while (session.queue.isNotEmpty() && session.drainScheduled.compareAndSet(false, true))
        } finally {
            session.drainScheduled.set(false)
        }
    }

    private fun finalizeSession(session: ActiveRecordingSession): RecordingCommandOutcome =
        try {
            drainQueue(session)
            session.writer.flush()
            session.writer.close()
            writeLatestPointer(session)
            session.writerThread.quitCompat()

            val eventCount = session.writtenEventCount.get()
            Log.i(
                LOG_TAG,
                "SESSION_STOPPED sessionId=${session.sessionId} file=${session.file.absolutePath} eventCount=$eventCount",
            )
            RecordingCommandOutcome.Stopped(
                sessionId = session.sessionId,
                filePath = session.file.absolutePath,
                eventCount = eventCount,
            )
        } catch (t: Throwable) {
            try {
                session.writer.close()
            } catch (_: IOException) {
            }
            session.writerThread.quitCompat()
            RecordingCommandOutcome.Error(
                code = "RECORDING_STOP_FAILED",
                message = t.message ?: "Failed to stop recording",
                sessionId = session.sessionId,
                filePath = session.file.absolutePath,
                eventCount = session.writtenEventCount.get(),
            )
        }

    private fun writeLatestPointer(session: ActiveRecordingSession) {
        val latestFile = session.recordingsDirectory.resolve(LATEST_POINTER_FILE_NAME)
        latestFile.writeText(session.sessionId)
    }

    private fun generateSessionId(): String {
        val now = System.currentTimeMillis()
        val suffix = UUID.randomUUID().toString().substring(0, 8)
        return "record-$now-$suffix"
    }

    private data class ActiveRecordingSession(
        val sessionId: String,
        val file: File,
        val recordingsDirectory: File,
        val writer: BufferedWriter,
        val writerThread: HandlerThread,
        val handler: Handler,
        val queue: ConcurrentLinkedQueue<RecordingEvent> = ConcurrentLinkedQueue(),
        val nextSequence: AtomicLong = AtomicLong(0),
        val writtenEventCount: AtomicInteger = AtomicInteger(0),
        val drainScheduled: AtomicBoolean = AtomicBoolean(false),
    )

    companion object {
        private const val LOG_TAG = "RecordingRuntime"
        private const val RECORDINGS_DIR_NAME = "recordings"
        private const val LATEST_POINTER_FILE_NAME = "latest"
        private const val SCHEMA_VERSION = 1
        private const val FINALIZE_TIMEOUT_SECONDS = 10L
    }
}

internal fun isSafeSessionId(sessionId: String): Boolean =
    sessionId.matches(Regex("[A-Za-z0-9_-]+"))

@Serializable
data class RecordingHeader(
    val type: String = "recording_header",
    val schemaVersion: Int,
    val sessionId: String,
    val startedAt: Long,
    val operatorPackage: String,
)

@Serializable
data class RecordingBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    companion object {
        val Zero = RecordingBounds(left = 0, top = 0, right = 0, bottom = 0)
    }
}

sealed interface RecordingEvent {
    val ts: Long
    val seq: Long
    val type: String
    val snapshot: String?
}

@Serializable
data class RecordingWindowChangeEvent(
    override val ts: Long,
    override val seq: Long,
    override val snapshot: String?,
    val packageName: String,
    val className: String?,
    val title: String?,
    override val type: String = "window_change",
) : RecordingEvent

@Serializable
data class RecordingClickEvent(
    override val ts: Long,
    override val seq: Long,
    override val snapshot: String?,
    val packageName: String,
    val resourceId: String?,
    val text: String?,
    val contentDesc: String?,
    val bounds: RecordingBounds,
    override val type: String = "click",
) : RecordingEvent

@Serializable
data class RecordingScrollEvent(
    override val ts: Long,
    override val seq: Long,
    override val snapshot: String? = null,
    val packageName: String,
    val resourceId: String?,
    val scrollX: Int,
    val scrollY: Int,
    val maxScrollX: Int,
    val maxScrollY: Int,
    override val type: String = "scroll",
) : RecordingEvent

@Serializable
data class RecordingPressKeyEvent(
    override val ts: Long,
    override val seq: Long,
    override val snapshot: String?,
    val key: String,
    override val type: String = "press_key",
) : RecordingEvent

@Serializable
data class RecordingTextChangeEvent(
    override val ts: Long,
    override val seq: Long,
    override val snapshot: String? = null,
    val packageName: String,
    val resourceId: String?,
    val text: String,
    override val type: String = "text_change",
) : RecordingEvent

internal data class RecordingSnapshotResult(
    val snapshot: String?,
    val rootUs: Double,
    val serializeUs: Double,
) {
    val totalUs: Double
        get() = rootUs + serializeUs
}

internal val recordingJson =
    Json {
        encodeDefaults = true
        explicitNulls = true
    }

internal fun nanosToMicros(durationNs: Long): Double = durationNs / 1_000.0

internal fun nowEpochMs(): Long = System.currentTimeMillis()

internal fun nowElapsedNanos(): Long =
    try {
        SystemClock.elapsedRealtimeNanos()
    } catch (_: NoSuchMethodError) {
        // Robolectric's shadow clock can miss this API even when the runtime SDK level supports it.
        System.nanoTime()
    }

private fun HandlerThread.quitCompat() {
    try {
        quitSafely()
    } catch (_: NoSuchMethodError) {
        quit()
    }
}

private fun serializeEvent(event: RecordingEvent): String =
    when (event) {
        is RecordingWindowChangeEvent ->
            recordingJson.encodeToString(
                serializer = RecordingWindowChangeEvent.serializer(),
                value = event,
            )
        is RecordingClickEvent ->
            recordingJson.encodeToString(
                serializer = RecordingClickEvent.serializer(),
                value = event,
            )
        is RecordingScrollEvent ->
            recordingJson.encodeToString(
                serializer = RecordingScrollEvent.serializer(),
                value = event,
            )
        is RecordingPressKeyEvent ->
            recordingJson.encodeToString(
                serializer = RecordingPressKeyEvent.serializer(),
                value = event,
            )
        is RecordingTextChangeEvent ->
            recordingJson.encodeToString(
                serializer = RecordingTextChangeEvent.serializer(),
                value = event,
            )
    }

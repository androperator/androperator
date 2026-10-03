package androperator.routine

import action.log.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlin.random.Random

class RoutineManagerDefault(
    private val scope: CoroutineScope,
) : RoutineManager {

    private sealed interface Msg {
        data class Start(val id: RoutineId, val routineRun: RoutineRun) : Msg
        data object Cancel : Msg
    }

    private val channel = Channel<Msg>(Channel.UNLIMITED)

    @Volatile
    private var activeJob: Job? = null

    @Volatile
    private var activeId: RoutineId? = null

    override suspend fun runLoop() {
        Log.i("[RoutineManager] runLoop started")
        try {
            for (msg in channel) {
                when (msg) {
                    is Msg.Start -> handleStart(msg)
                    Msg.Cancel -> handleCancel()
                }
            }
        } catch (t: CancellationException) {
            Log.d("[RoutineManager] runLoop cancelled: ${t.message}")
        } finally {
            handleCancel()
            Log.i("[RoutineManager] runLoop finished")
        }
    }

    override fun start(build: () -> RoutineRun): RoutineId {
        val id = RoutineId("${System.currentTimeMillis()}-${Random.nextInt(1000, 10_000)}")
        val routineRun = build()
        Log.i("[RoutineManager] start requested id=${id.value} spec=${routineRun.routineSpec}")
        val result = channel.trySend(Msg.Start(id, routineRun))
        if (!result.isSuccess) {
            Log.w("[RoutineManager] failed to send start message for id=${id.value}: ${result}")
        }
        return id
    }

    override fun cancelCurrent(): Boolean {
        val running = activeJob?.isActive == true
        if (running) {
            Log.i("[RoutineManager] cancel requested for id=${activeId?.value}")
        }
        val result = channel.trySend(Msg.Cancel)
        if (!result.isSuccess) {
            Log.w("[RoutineManager] failed to send cancel message: ${result}")
        }
        return running
    }

    override val isRunning: Boolean
        get() = activeJob?.isActive == true

    private suspend fun handleStart(msg: Msg.Start) {
        Log.i("[RoutineManager] starting routine id=${msg.id.value}")
        val previousId = activeId
        if (activeJob != null) {
            Log.i("[RoutineManager] cancelling previous routine id=${previousId?.value}")
        }
        activeJob?.cancelAndJoin()

        val job = scope.launch {
            try {
                msg.routineRun.routine.run(
                    routineSpec = msg.routineRun.routineSpec,
                    routineStatusSink = msg.routineRun.routineStatusSink,
                )
                Log.i("[RoutineManager] routine completed id=${msg.id.value}")
            } catch (t: CancellationException) {
                Log.i("[RoutineManager] routine cancelled id=${msg.id.value}")
                throw t
            } catch (t: Throwable) {
                Log.e(t, "[RoutineManager] routine failed id=${msg.id.value}")
            } finally {
                if (activeId == msg.id) {
                    activeJob = null
                    activeId = null
                    Log.i("[RoutineManager] cleared active routine id=${msg.id.value}")
                }
            }
        }
        activeJob = job
        activeId = msg.id
    }

    private suspend fun handleCancel() {
        activeJob?.cancelAndJoin()
        if (activeId != null) {
            Log.i("[RoutineManager] routine cancelled id=${activeId?.value}")
        }
        activeJob = null
        activeId = null
    }
}

package clawperator.operator.agent

import action.log.Log
import android.net.LocalServerSocket
import android.net.LocalSocket
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Experimental one-command endpoints. No shared client port or mutable selected device. */
internal object DirectResultConnection {
    private const val MAX_SESSIONS = 16
    private val sessions = mutableMapOf<String, Session>()
    private val deadlines = ScheduledThreadPoolExecutor(1) { runnable ->
        Thread(runnable, "operator-result-deadlines").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }

    fun prepare(operatorPackage: String, payload: String) {
        val request = JSONObject(payload)
        require(request.getInt("protocol") == 1)
        val sessionId = request.getString("sessionId")
        require(sessionId.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")))
        val commandId = request.getString("commandId")
        val taskId = request.getString("taskId")
        require(commandId.isNotBlank() && taskId.isNotBlank())
        val lifetimeMs = request.getLong("lifetimeMs")
        require(lifetimeMs in 1..150_000)
        val session = synchronized(sessions) {
            require(sessions.size < MAX_SESSIONS && !sessions.containsKey(sessionId))
            Session(sessionId, commandId, taskId, operatorPackage).also { sessions[sessionId] = it }
        }
        val expiry = deadlines.schedule({ session.close() }, lifetimeMs, TimeUnit.MILLISECONDS)
        Thread({
            try {
                session.serve()
            } catch (_: Exception) {
                // Never log result contents or session credentials. No logcat fallback after dispatch.
                Log.d("[Clawperator-DirectResult] Connection closed or failed")
            } finally {
                expiry.cancel(false)
                session.close()
            }
        }, "operator-result-connection").apply { isDaemon = true }.start()
    }

    /** Claim exactly once before any command effect, including closing the notification panel. */
    fun claim(sessionId: String, command: AgentCommand): Boolean = synchronized(sessions) {
        val session = sessions[sessionId] ?: return false
        if (!session.ready || session.claimed || session.commandId != command.commandId || session.taskId != command.taskId) return false
        session.claimed = true
        true
    }

    fun publish(sessionId: String, canonicalLine: String) {
        val session = synchronized(sessions) { sessions[sessionId] }
        if (session == null || !session.result.complete(canonicalLine)) {
            Log.d("[Clawperator-DirectResult] Result destination expired or already completed")
        }
    }

    private class Session(
        val sessionId: String,
        val commandId: String,
        val taskId: String,
        val operatorPackage: String,
    ) {
        private val server = LocalServerSocket("$operatorPackage.result.$sessionId")

        @Volatile private var socket: LocalSocket? = null

        @Volatile private var closed = false

        @Volatile var ready = false
        var claimed = false // protected by sessions monitor
        val result = CompletableFuture<String>()

        fun close() {
            synchronized(sessions) {
                closed = true
                if (sessions[sessionId] === this) sessions.remove(sessionId)
            }
            result.completeExceptionally(IllegalStateException("Direct result session closed"))
            try {
                socket?.close()
            } catch (_: Exception) { }
            try {
                server.close()
            } catch (_: Exception) { }
        }

        fun serve() {
            val connected = server.accept()
            synchronized(sessions) {
                if (closed) {
                    connected.close()
                    return
                }
                socket = connected
            }
            // Only adb's shell/root peer may consume results, not ordinary device apps.
            require(connected.peerCredentials.uid == 2000 || connected.peerCredentials.uid == 0)
            connected.soTimeout = 5000
            DirectResultProtocol(sessionId, commandId, taskId, operatorPackage).serve(
                DataInputStream(connected.inputStream),
                DataOutputStream(connected.outputStream),
                onReady = { ready = true },
                result = { result.get() },
            )
        }
    }
}

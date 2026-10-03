package androperator.operator.debug

import action.log.Log
import android.app.Activity
import android.os.Bundle
import androperator.operator.onscreenlog.OnScreenLogPanelController
import androperator.operator.onscreenlog.OnScreenLogAppMetadata
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import androperator.task.runner.OnScreenLogAnchor
import androperator.task.runner.OnScreenLogController
import androperator.task.runner.OnScreenLogControllerResult
import androperator.task.runner.OnScreenLogSpec
import androperator.task.runner.OnScreenLogTextAlign
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

/**
 * Debug-only validation fixture with fixed scenarios. The manifest requires DUMP permission
 * so only privileged callers such as ADB shell can change the shared diagnostic panel.
 */
class OnScreenLogProofActivity :
    Activity(),
    KoinComponent {
    private val controller: OnScreenLogController by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scenario = intent.getStringExtra(EXTRA_SCENARIO)
        CoroutineScope(Dispatchers.Main.immediate).launch {
            val result =
                when (scenario) {
                    SCENARIO_LEFT ->
                        controller.set(
                            OnScreenLogSpec(
                                text = "PHASE-1 LEFT: Input remains active",
                                topOffsetDp = 24,
                                edgeOffsetDp = 12,
                            ),
                        )

                    SCENARIO_RIGHT ->
                        controller.set(
                            OnScreenLogSpec(
                                text = "PHASE-1 RIGHT: Updated label",
                                anchor = OnScreenLogAnchor.Right,
                                textAlign = OnScreenLogTextAlign.Right,
                                topOffsetDp = 24,
                                edgeOffsetDp = 12,
                                textColor = "#FF112233",
                                backgroundColor = "#CCF1F4F8",
                            ),
                        )

                    SCENARIO_INPUT ->
                        controller.set(
                            OnScreenLogSpec(
                                text = "PHASE-1 INPUT: Touch passes through",
                                topOffsetDp = 160,
                                edgeOffsetDp = 12,
                            ),
                        )

                    "template-missing", "template-long", "template-clear-pending", "template-expire-pending", "template-replace-pending" ->
                        templateProof(scenario)
                    SCENARIO_CLEAR -> controller.clear()
                    else ->
                        OnScreenLogControllerResult.Failure(
                            errorCode = "ON_SCREEN_LOG_PROOF_SCENARIO_INVALID",
                            message = "Unsupported debug proof scenario: $scenario",
                        )
                }
            Log.i("[OnScreenLogProof] scenario=$scenario result=$result")
            finish()
        }
    }

    private suspend fun templateProof(scenario: String): OnScreenLogControllerResult {
        val started = CompletableDeferred<Unit>()
        val result = (controller as OnScreenLogPanelController).setWithMetadataLoader(
            OnScreenLogSpec(
                template = "{{foreground_app.icon}} {{foreground_app.package_name}}\n{{foreground_app.version_code}} | {{foreground_app.version_name}}",
                widthDp = if (scenario == "template-long") 80 else 500,
                fontSizeSp = 18,
                ttlMs = if (scenario == "template-expire-pending") 1000 else 10000,
            ),
        ) { _, packageName ->
            android.util.Log.i("OnScreenLogTemplateProof", "LOOKUP_START scenario=$scenario")
            started.complete(Unit)
            if (scenario.endsWith("pending")) withContext(NonCancellable) { delay(2500) }
            android.util.Log.i("OnScreenLogTemplateProof", "LOOKUP_END scenario=$scenario")
            if (scenario == "template-long") OnScreenLogAppMetadata(packageName, "4294967297", "long metadata ".repeat(40))
            else OnScreenLogAppMetadata(packageName)
        }
        // Finish first so real application identity can be observed under this translucent activity.
        finish()
        if (scenario.endsWith("pending")) {
            withTimeout(5000) { started.await() }
            delay(250)
            when (scenario) {
                "template-clear-pending" -> controller.clear()
                "template-replace-pending" -> controller.set(OnScreenLogSpec(text = "REPLACEMENT survives obsolete lookup", ttlMs = 5000))
            }
        }
        return result
    }

    private companion object {
        const val EXTRA_SCENARIO = "scenario"
        const val SCENARIO_LEFT = "left"
        const val SCENARIO_RIGHT = "right"
        const val SCENARIO_INPUT = "input"
        const val SCENARIO_CLEAR = "clear"
    }
}

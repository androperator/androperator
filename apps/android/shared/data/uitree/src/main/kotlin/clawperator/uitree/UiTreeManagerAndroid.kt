package clawperator.uitree

import action.log.Log
import android.accessibilityservice.AccessibilityService
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inputmethod.EditorInfo
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import clawperator.accessibilityservice.AccessibilityServiceManager
import clawperator.accessibilityservice.NoOpTextInputConnectionSource
import clawperator.accessibilityservice.TextInputConnectionSource
import clawperator.accessibilityservice.TextInputEditorInfo
import clawperator.accessibilityservice.TextInputSession
import clawperator.accessibilityservice.boundsInScreenRect
import clawperator.accessibilityservice.currentAccessibilityService
import clawperator.accessibilityservice.debugNode
import clawperator.accessibilityservice.debugNodeRedacted
import clawperator.accessibilityservice.dispatchLongPress
import clawperator.accessibilityservice.dispatchSingleTap
import clawperator.accessibilityservice.dispatchDrag
import clawperator.accessibilityservice.dispatchSwipe
import clawperator.accessibilityservice.firstClickableAncestorOrSelf
import clawperator.accessibilityservice.firstEditableAncestorOrSelf
import clawperator.accessibilityservice.firstFocusableAncestorOrSelf

class UiTreeManagerAndroid(
    private val accessibilityServiceManager: AccessibilityServiceManager,
) : UiTreeManager {
    // Use the service manager as the API 33 text-input bridge when available.
    private val inputConnectionSource: TextInputConnectionSource =
        accessibilityServiceManager as? TextInputConnectionSource ?: NoOpTextInputConnectionSource

    private suspend fun dispatch(target: Any?, method: String, action: suspend () -> Boolean): Boolean {
        observeDispatch(target, method, false)
        return action().also {
            // Gesture acceptance is observed at dispatchGesture, before its asynchronous callback.
            if (method != "coordinate_gesture") observeDispatch(target, method, it)
        }
    }

    override suspend fun dragAt(startX: Int, startY: Int, endX: Int, endY: Int, holdDurationMs: Long, moveDurationMs: Long): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val service = accessibilityServiceManager.currentAccessibilityService ?: return false
        val metrics = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        (service.getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(metrics)
        if (startX !in 0 until metrics.widthPixels || endX !in 0 until metrics.widthPixels ||
            startY !in 0 until metrics.heightPixels || endY !in 0 until metrics.heightPixels ||
            (startX == endX && startY == endY) || holdDurationMs !in 1L..10000L || moveDurationMs !in 1L..10000L) return false
        return dispatch(null, "coordinate_gesture") {
            service.dispatchDrag(startX.toFloat(), startY.toFloat(), endX.toFloat(), endY.toFloat(), holdDurationMs, moveDurationMs)
        }
    }

    override suspend fun swipeAt(startX: Int, startY: Int, endX: Int, endY: Int, durationMs: Long): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val service = accessibilityServiceManager.currentAccessibilityService ?: return false
        val metrics = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        (service.getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(metrics)
        if (startX !in 0 until metrics.widthPixels || endX !in 0 until metrics.widthPixels ||
            startY !in 0 until metrics.heightPixels || endY !in 0 until metrics.heightPixels ||
            (startX == endX && startY == endY) || durationMs !in 1L..10000L) return false
        return dispatch(null, "coordinate_gesture") {
            service.dispatchSwipe(startX.toFloat(), startY.toFloat(), endX.toFloat(), endY.toFloat(), durationMs)
        }
    }

    override suspend fun triggerClick(
        uiNode: UiNode,
        clickTypes: UiTreeClickTypes,
    ): Boolean {
        // Get the live AccessibilityNodeInfo from the direct reference
        val service = accessibilityServiceManager.currentAccessibilityService ?: return false
        val accessibilityNodeInfo = uiNode.accessibilityNodeInfo as? AccessibilityNodeInfo ?: return false

        // Try each click type in order until one succeeds
        for (clickType in clickTypes.ordered) {
            val success =
                when (clickType) {
                    UiTreeClickType.Click -> performClick(accessibilityNodeInfo, service, uiNode)
                    UiTreeClickType.LongClick -> performLongClick(accessibilityNodeInfo, service, uiNode)
                    UiTreeClickType.Focus -> performFocus(accessibilityNodeInfo, uiNode)
                }

            if (success) {
                Log.d("[UiTreeManager] Successfully performed $clickType on node for id=${uiNode.id}")
                return true
            }
        }

        Log.d("[UiTreeManager] All click types failed for id=${uiNode.id}")
        return false
    }

    override suspend fun clickAt(
        x: Float,
        y: Float,
        clickTypes: UiTreeClickTypes,
    ): Boolean {
        val service = accessibilityServiceManager.currentAccessibilityService ?: return false

        for (clickType in clickTypes.ordered) {
            val success =
                when (clickType) {
                    UiTreeClickType.Click -> dispatch(null, "coordinate_gesture") { service.dispatchSingleTap(x, y) }
                    UiTreeClickType.LongClick -> dispatch(null, "coordinate_gesture") { service.dispatchLongPress(x, y) }
                    UiTreeClickType.Focus -> {
                        Log.w("[UiTreeManager] Focus click type is not supported for raw coordinates at ($x,$y)")
                        false
                    }
                }

            if (success) {
                Log.d("[UiTreeManager] Successfully performed $clickType at ($x,$y)")
                return true
            }
        }

        Log.d("[UiTreeManager] All coordinate click types failed at ($x,$y)")
        return false
    }

    override suspend fun setText(
        uiNode: UiNode,
        text: String,
        submit: Boolean,
        clear: Boolean,
    ): TextSubmissionOutcome? {
        val accessibilityNodeInfo = uiNode.accessibilityNodeInfo as? AccessibilityNodeInfo ?: return null
        val target = accessibilityNodeInfo.firstEditableAncestorOrSelf() ?: accessibilityNodeInfo
        val request =
            TextEntryRequest(
                uiNode = uiNode,
                target = target,
                text = text,
                submit = submit,
                clear = clear,
                replacementSemantics = ReplacementSemantics.ReplaceExistingContent,
            )

        for (strategy in textEntryStrategies) {
            if (!strategy.supports(request.replacementSemantics)) {
                continue
            }
            val minimumSdk = strategy.minimumSdk
            if (minimumSdk != null && Build.VERSION.SDK_INT < minimumSdk) {
                continue
            }
            val attempt = strategy.attempt(request) ?: continue
            Log.d(
                "[UiTreeManager] enter_text strategy=${strategy.name} submit_method=${attempt.submitMethod.wireValue} succeeded for id=${uiNode.id}",
            )
            return attempt.submitMethod
        }

        Log.d("[UiTreeManager] All enter_text strategies failed for id=${uiNode.id}")
        return null
    }

    override suspend fun swipeWithinVertical(
        uiNode: UiNode,
        startYRatio: Float,
        endYRatio: Float,
        durationMs: Long,
    ): Boolean {
        val service = accessibilityServiceManager.currentAccessibilityService ?: return false

        // Get the live AccessibilityNodeInfo from the direct reference
        val accessibilityNodeInfo = uiNode.accessibilityNodeInfo as? AccessibilityNodeInfo ?: return false
        val bounds = accessibilityNodeInfo.boundsInScreenRect
        if (bounds.isEmpty) return false

        val centerX = bounds.exactCenterX()
        val startY = bounds.top + (bounds.height() * startYRatio)
        val endY = bounds.top + (bounds.height() * endYRatio)

        return dispatch(accessibilityNodeInfo, "coordinate_gesture") { service.dispatchSwipe(centerX, startY, centerX, endY, durationMs) }
    }

    override suspend fun swipeWithinHorizontal(
        uiNode: UiNode,
        startXRatio: Float,
        endXRatio: Float,
        durationMs: Long,
    ): Boolean {
        val service = accessibilityServiceManager.currentAccessibilityService ?: return false

        // Get the live AccessibilityNodeInfo from the direct reference
        val accessibilityNodeInfo = uiNode.accessibilityNodeInfo as? AccessibilityNodeInfo ?: return false
        val bounds = accessibilityNodeInfo.boundsInScreenRect
        if (bounds.isEmpty) return false

        val centerY = bounds.exactCenterY()
        val startX = bounds.left + (bounds.width() * startXRatio)
        val endX = bounds.left + (bounds.width() * endXRatio)

        return dispatch(accessibilityNodeInfo, "coordinate_gesture") { service.dispatchSwipe(startX, centerY, endX, centerY, durationMs) }
    }

    // --- Click type implementations ---

    /**
     * Performs a regular click: try ACTION_CLICK on clickable ancestor, fallback to gesture tap
     */
    private suspend fun performClick(
        accessibilityNodeInfo: AccessibilityNodeInfo,
        service: AccessibilityService,
        uiNode: UiNode,
    ): Boolean {
        // 1) Try ACTION_CLICK on clickable ancestor
        accessibilityNodeInfo.firstClickableAncestorOrSelf()?.let { clickable ->
            if (clickable.isEnabled && dispatch(clickable, "accessibility_action") { clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK) }) {
                Log.d("[UiTreeManager] Clicked via ACTION_CLICK on ${clickable.debugNode()} for id=${uiNode.id}")
                return true
            }
        }

        // 2) Gesture fallback: tap center of node bounds
        val bounds = accessibilityNodeInfo.boundsInScreenRect
        if (!bounds.isEmpty) {
            val cx = bounds.exactCenterX()
            val cy = bounds.exactCenterY()
            val ok = dispatch(accessibilityNodeInfo, "coordinate_gesture") { service.dispatchSingleTap(cx, cy) }
            Log.d("[UiTreeManager] Clicked via gesture at ($cx,$cy) for id=${uiNode.id} -> $ok")
            return ok
        }

        return false
    }

    /**
     * Performs a long click: try ACTION_LONG_CLICK on clickable ancestor, fallback to long-press gesture
     */
    private suspend fun performLongClick(
        accessibilityNodeInfo: AccessibilityNodeInfo,
        service: AccessibilityService,
        uiNode: UiNode,
    ): Boolean {
        // 1) Try ACTION_LONG_CLICK on clickable ancestor
        accessibilityNodeInfo.firstClickableAncestorOrSelf()?.let { clickable ->
            if (clickable.isEnabled && dispatch(clickable, "accessibility_action") { clickable.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK) }) {
                Log.d("[UiTreeManager] Long-clicked via ACTION_LONG_CLICK on ${clickable.debugNode()} for id=${uiNode.id}")
                return true
            }
        }

        // 2) Gesture fallback: long-press center of node bounds
        val bounds = accessibilityNodeInfo.boundsInScreenRect
        if (!bounds.isEmpty) {
            val cx = bounds.exactCenterX()
            val cy = bounds.exactCenterY()
            val ok = dispatch(accessibilityNodeInfo, "coordinate_gesture") { service.dispatchLongPress(cx, cy) }
            Log.d("[UiTreeManager] Long-clicked via gesture at ($cx,$cy) for id=${uiNode.id} -> $ok")
            return ok
        }

        return false
    }

    /**
     * Performs focus: try ACTION_FOCUS, fallback to ACTION_SELECT (no gesture fallback)
     */
    private suspend fun performFocus(
        accessibilityNodeInfo: AccessibilityNodeInfo,
        uiNode: UiNode,
    ): Boolean {
        val target = accessibilityNodeInfo.firstFocusableAncestorOrSelf() ?: accessibilityNodeInfo

        // Try ACTION_FOCUS first
        if (dispatch(target, "accessibility_action") { target.performAction(AccessibilityNodeInfo.ACTION_FOCUS) }) {
            Log.d("[UiTreeManager] Focused via ACTION_FOCUS on ${target.debugNode()} for id=${uiNode.id}")
            return true
        }

        // Try ACTION_SELECT as fallback
        if (dispatch(target, "accessibility_action") { target.performAction(AccessibilityNodeInfo.ACTION_SELECT) }) {
            Log.d("[UiTreeManager] Selected via ACTION_SELECT on ${target.debugNode()} for id=${uiNode.id}")
            return true
        }

        return false
    }

    private val textEntryStrategies: List<TextEntryStrategy> =
        listOf(
            LegacySetTextStrategy,
            Api33InputConnectionStrategy(),
        )

    private data class TextEntryRequest(
        val uiNode: UiNode,
        val target: AccessibilityNodeInfo,
        val text: String,
        val submit: Boolean,
        val clear: Boolean,
        val replacementSemantics: ReplacementSemantics,
    )

    private enum class ReplacementSemantics {
        ReplaceExistingContent,
    }

    private sealed interface TextEntryStrategy {
        val name: String
        val minimumSdk: Int?
            get() = null

        fun supports(replacementSemantics: ReplacementSemantics): Boolean

        suspend fun attempt(request: TextEntryRequest): TextEntryAttemptResult?
    }

    private data class TextEntryAttemptResult(
        val submitMethod: TextSubmissionOutcome,
    )

    private object LegacySetTextStrategy : TextEntryStrategy {
        override val name: String = "legacy_action_set_text"

        override fun supports(replacementSemantics: ReplacementSemantics): Boolean =
            replacementSemantics == ReplacementSemantics.ReplaceExistingContent

        override suspend fun attempt(request: TextEntryRequest): TextEntryAttemptResult? {
            val target = request.target

            // Best-effort focus before setting text.
            if (!target.isFocused) {
                prepareTextEntryFocus(target)
            }

            // Clear via ACTION_SET_TEXT with an empty CharSequence so clear=true fails
            // truthfully if the requested clear step cannot be performed.
            if (request.clear) {
                val clearArgs =
                    Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
                    }
                val clearSucceeded = dispatchTextReplacement(target, clearArgs)
                if (!clearSucceeded) {
                    Log.d(
                        "[UiTreeManager] enter_text strategy=$name clear_failed for id=${request.uiNode.id} on ${target.debugNodeRedacted()}",
                    )
                    return null
                }
            }

            val args =
                Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, request.text)
                }

            val setTextSucceeded = dispatchTextReplacement(target, args)
            if (!setTextSucceeded) {
                Log.d(
                    "[UiTreeManager] enter_text strategy=$name set_text_failed for id=${request.uiNode.id} on ${target.debugNodeRedacted()}",
                )
                return null
            }

            return TextEntryAttemptResult(submitMethod = performLegacySubmit(target, request.submit))
        }

        // A rejected set-text action can fall back to an editor session on a later attempt.
        // Successful or uncertain mutations must never be replayed by the outer retry loop.
        private suspend fun dispatchTextReplacement(target: AccessibilityNodeInfo, args: Bundle): Boolean {
            observeDispatch(target, "accessibility_action", false, blocksRetry = false)
            val accepted = try {
                target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            } catch (error: Exception) {
                observeDispatch(target, "accessibility_action", false)
                throw error
            }
            observeDispatch(target, "accessibility_action", accepted, blocksRetry = accepted)
            return accepted
        }

        private fun performLegacySubmit(
            target: AccessibilityNodeInfo,
            submitRequested: Boolean,
        ): TextSubmissionOutcome {
            if (!submitRequested) {
                return TextSubmissionOutcome.NotRequested
            }

            if (
                supportsImeEnterAction(target) &&
                target.performAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_IME_ENTER.id)
            ) {
                return TextSubmissionOutcome.ImeEditorAction
            }

            return if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                TextSubmissionOutcome.ClickFallback
            } else {
                TextSubmissionOutcome.Unavailable
            }
        }

        private fun supportsImeEnterAction(target: AccessibilityNodeInfo): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                return false
            }
            return AccessibilityNodeInfoCompat.wrap(target).actionList.any { action ->
                action.id == AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_IME_ENTER.id
            }
        }
    }

    private inner class Api33InputConnectionStrategy : TextEntryStrategy {
        override val name: String = "api33_input_connection"
        override val minimumSdk: Int = Build.VERSION_CODES.TIRAMISU

        override fun supports(replacementSemantics: ReplacementSemantics): Boolean =
            replacementSemantics == ReplacementSemantics.ReplaceExistingContent

        override suspend fun attempt(request: TextEntryRequest): TextEntryAttemptResult? {
            val target = request.target

            if (!target.isFocused) {
                prepareTextEntryFocus(target)
                // InputMethod session ownership updates asynchronously after focus changes.
                // Stop here and let the existing UiReadiness retry rerun once the editor session
                // catches up instead of mutating a stale or not-yet-started connection.
                logUnavailable(request, "session_pending_after_focus")
                return null
            }

            val session = inputConnectionSource.currentSession()
            if (session == null) {
                logUnavailable(request, "session_unavailable")
                return null
            }

            if (!session.isActive) {
                logUnavailable(request, "input_finished")
                return null
            }

            observeDispatch(target, "accessibility_action", false)
            when (val replaceResult = replaceText(session, request)) {
                ReplaceTextResult.Success -> observeDispatch(target, "accessibility_action", true)
                is ReplaceTextResult.Unavailable -> {
                    if (replaceResult.partialFailure) {
                        logPartialFailure(request, replaceResult.reason)
                    } else {
                        logUnavailable(request, replaceResult.reason)
                    }
                    return null
                }
            }

            return TextEntryAttemptResult(
                submitMethod = performSubmit(session, session.editorInfo, request.submit),
            )
        }

        private fun replaceText(
            session: TextInputSession,
            request: TextEntryRequest,
        ): ReplaceTextResult {
            val cursorMovedToEnd = session.setSelection(Int.MAX_VALUE, Int.MAX_VALUE)
            if (!cursorMovedToEnd) {
                return ReplaceTextResult.Unavailable(reason = "selection_unavailable")
            }

            val cleared = session.deleteSurroundingText(Int.MAX_VALUE, 0)
            if (!cleared) {
                return ReplaceTextResult.Unavailable(reason = "delete_unavailable")
            }

            return if (session.commitText(request.text, 1)) {
                ReplaceTextResult.Success
            } else {
                ReplaceTextResult.Unavailable(
                    reason = "commit_failed_after_delete",
                    partialFailure = true,
                )
            }
        }

        private fun performSubmit(
            session: TextInputSession,
            editorInfo: TextInputEditorInfo?,
            submitRequested: Boolean,
        ): TextSubmissionOutcome {
            if (!submitRequested) {
                return TextSubmissionOutcome.NotRequested
            }

            val editorAction = editorInfo?.let(::resolveEditorAction) ?: return TextSubmissionOutcome.Unavailable
            return if (session.performEditorAction(editorAction)) {
                TextSubmissionOutcome.ImeEditorAction
            } else {
                TextSubmissionOutcome.Unavailable
            }
        }

        private fun resolveEditorAction(editorInfo: TextInputEditorInfo): Int? {
            if (editorInfo.actionId != 0) {
                return editorInfo.actionId
            }

            val action = editorInfo.imeOptions and EditorInfo.IME_MASK_ACTION
            if (action == EditorInfo.IME_ACTION_NONE || action == EditorInfo.IME_ACTION_UNSPECIFIED) {
                return null
            }
            if ((editorInfo.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION) != 0) {
                return null
            }
            return action
        }

        private fun logUnavailable(
            request: TextEntryRequest,
            reason: String,
        ) {
            Log.d(
                "[UiTreeManager] enter_text strategy=$name unavailable reason=$reason for id=${request.uiNode.id}",
            )
        }

        private fun logPartialFailure(
            request: TextEntryRequest,
            reason: String,
        ) {
            Log.w(
                "[UiTreeManager] enter_text strategy=$name partial_failure reason=$reason for id=${request.uiNode.id}",
            )
        }
    }

    private sealed interface ReplaceTextResult {
        data object Success : ReplaceTextResult

        data class Unavailable(
            val reason: String,
            val partialFailure: Boolean = false,
        ) : ReplaceTextResult
    }
}

// Completed focus preparation permits readiness retries, but an exception leaves
// the dispatch outcome uncertain and must prevent the outer loop from replaying it.
private suspend fun prepareTextEntryFocus(target: AccessibilityNodeInfo) {
    for (action in listOf(AccessibilityNodeInfo.ACTION_FOCUS, AccessibilityNodeInfo.ACTION_CLICK)) {
        observeDispatch(target, "accessibility_action", false, blocksRetry = false)
        val accepted = try {
            target.performAction(action)
        } catch (error: Exception) {
            observeDispatch(target, "accessibility_action", false)
            throw error
        }
        observeDispatch(target, "accessibility_action", accepted, blocksRetry = false)
    }
}

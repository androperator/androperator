package androperator.accessibilityservice

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.InputMethod
import android.os.Build
import android.view.inputmethod.EditorInfo
import androidx.annotation.RequiresApi

interface TextInputConnectionSource {
    fun currentSession(): TextInputSession?
}

interface TextInputSession {
    val isActive: Boolean
    val editorInfo: TextInputEditorInfo?

    fun setSelection(
        start: Int,
        end: Int,
    ): Boolean

    fun deleteSurroundingText(
        beforeLength: Int,
        afterLength: Int,
    ): Boolean

    fun commitText(
        text: CharSequence,
        newCursorPosition: Int,
    ): Boolean

    fun performEditorAction(editorAction: Int): Boolean
}

data class TextInputEditorInfo(
    val actionId: Int,
    val imeOptions: Int,
)

object NoOpTextInputConnectionSource : TextInputConnectionSource {
    override fun currentSession(): TextInputSession? = null
}

internal fun AccessibilityService.currentTextInputSession(): TextInputSession? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        return null
    }
    return currentTextInputSessionApi33()
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun AccessibilityService.currentTextInputSessionApi33(): TextInputSession? =
    getInputMethod()?.let(::AccessibilityInputMethodSession)

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class AccessibilityInputMethodSession(
    private val inputMethod: InputMethod,
) : TextInputSession {
    override val isActive: Boolean
        get() = inputMethod.currentInputStarted

    override val editorInfo: TextInputEditorInfo?
        get() = inputMethod.currentInputEditorInfo?.toTextInputEditorInfo()

    override fun setSelection(
        start: Int,
        end: Int,
    ): Boolean {
        val connection = inputMethod.currentInputConnection ?: return false
        // AccessibilityInputConnection mutators are fire-and-forget on this API surface,
        // so dispatch onto a non-null connection is the strongest signal available here.
        connection.setSelection(start, end)
        return true
    }

    override fun deleteSurroundingText(
        beforeLength: Int,
        afterLength: Int,
    ): Boolean {
        val connection = inputMethod.currentInputConnection ?: return false
        connection.deleteSurroundingText(beforeLength, afterLength)
        return true
    }

    override fun commitText(
        text: CharSequence,
        newCursorPosition: Int,
    ): Boolean {
        val connection = inputMethod.currentInputConnection ?: return false
        connection.commitText(text, newCursorPosition, null)
        return true
    }

    override fun performEditorAction(editorAction: Int): Boolean {
        val connection = inputMethod.currentInputConnection ?: return false
        connection.performEditorAction(editorAction)
        return true
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun EditorInfo.toTextInputEditorInfo(): TextInputEditorInfo =
    TextInputEditorInfo(
        actionId = actionId,
        imeOptions = imeOptions,
    )

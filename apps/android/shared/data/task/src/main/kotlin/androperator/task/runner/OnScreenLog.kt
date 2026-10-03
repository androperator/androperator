package androperator.task.runner

import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * Logical configuration for the Operator-owned diagnostic panel.
 *
 * This object intentionally stores caller values rather than screen pixels. Android converts
 * dp and sp only when a connected accessibility service lays out the panel.
 */
data class OnScreenLogSpec(
    val text: String? = null,
    val anchor: OnScreenLogAnchor = OnScreenLogAnchor.Left,
    val textAlign: OnScreenLogTextAlign = OnScreenLogTextAlign.Left,
    val topOffsetDp: Int = OnScreenLogContract.DEFAULT_TOP_OFFSET_DP,
    val edgeOffsetDp: Int = OnScreenLogContract.DEFAULT_EDGE_OFFSET_DP,
    val widthDp: Int = OnScreenLogContract.DEFAULT_WIDTH_DP,
    val fontSizeSp: Int = OnScreenLogContract.DEFAULT_FONT_SIZE_SP,
    val textColor: String = OnScreenLogContract.DEFAULT_TEXT_COLOR,
    val backgroundColor: String = OnScreenLogContract.DEFAULT_BACKGROUND_COLOR,
    val ttlMs: Long = OnScreenLogContract.DEFAULT_TTL_MS,
    val template: String? = null,
)

enum class OnScreenLogAnchor(
    val wireValue: String,
) {
    Left("left"),
    Right("right"),
}

enum class OnScreenLogTextAlign(
    val wireValue: String,
) {
    Left("left"),
    Right("right"),
}

/** A validated panel configuration with canonical uppercase color values. */
data class NormalizedOnScreenLogSpec(
    val text: String,
    val anchor: OnScreenLogAnchor,
    val textAlign: OnScreenLogTextAlign,
    val topOffsetDp: Int,
    val edgeOffsetDp: Int,
    val widthDp: Int,
    val fontSizeSp: Int,
    val textColor: String,
    val backgroundColor: String,
    val ttlMs: Long,
    val template: String? = null,
)

/** Raised before a controller mutates a currently visible panel. */
class OnScreenLogValidationException(
    message: String,
) : IllegalArgumentException(message)

/** Raised when a valid logical panel does not fit the current usable display rectangle. */
class OnScreenLogLayoutException(
    message: String,
) : IllegalArgumentException(message)

object OnScreenLogContract {
    const val MIN_TEXT_LENGTH = 1
    const val MAX_TEXT_LENGTH = 2_048
    const val MIN_OFFSET_DP = 0
    const val MAX_OFFSET_DP = 1_000
    const val MIN_WIDTH_DP = 80
    const val MAX_WIDTH_DP = 600
    const val MIN_FONT_SIZE_SP = 8
    const val MAX_FONT_SIZE_SP = 24
    const val MIN_TTL_MS = 1_000L
    const val MAX_TTL_MS = 3_600_000L
    const val DEFAULT_TOP_OFFSET_DP = 8
    const val DEFAULT_EDGE_OFFSET_DP = 8
    const val DEFAULT_WIDTH_DP = 280
    const val DEFAULT_FONT_SIZE_SP = 12
    const val DEFAULT_TEXT_COLOR = "#FFFFFFFF"
    const val DEFAULT_BACKGROUND_COLOR = "#B3000000"
    const val DEFAULT_TTL_MS = 300_000L
    const val PANEL_PADDING_DP = 8
    const val MAX_DRAW_ACKNOWLEDGEMENT_MS = 2_000L

    private val colorPattern = Regex("^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")

    // Keep this list aligned with the explicit ECMAScript whitespace set used by the Node
    // validator. In particular, Kotlin's Char.isWhitespace does not treat U+FEFF as whitespace.
    private fun isContractWhitespace(character: Char): Boolean =
        character in '\u0009'..'\u000D' ||
            character == '\u0020' ||
            character == '\u00A0' ||
            character == '\u1680' ||
            character in '\u2000'..'\u200A' ||
            character == '\u2028' ||
            character == '\u2029' ||
            character == '\u202F' ||
            character == '\u205F' ||
            character == '\u3000' ||
            character == '\uFEFF'

    fun normalize(spec: OnScreenLogSpec): NormalizedOnScreenLogSpec {
        requireValidation((spec.text != null) != (spec.template != null)) {
            "exactly one of text or template is required"
        }
        validateText(spec.text ?: spec.template!!)
        spec.template?.let(OnScreenLogTemplate::parse)
        validateRange("topOffsetDp", spec.topOffsetDp, MIN_OFFSET_DP, MAX_OFFSET_DP)
        validateRange("edgeOffsetDp", spec.edgeOffsetDp, MIN_OFFSET_DP, MAX_OFFSET_DP)
        validateRange("widthDp", spec.widthDp, MIN_WIDTH_DP, MAX_WIDTH_DP)
        validateRange("fontSizeSp", spec.fontSizeSp, MIN_FONT_SIZE_SP, MAX_FONT_SIZE_SP)
        requireValidation(spec.ttlMs in MIN_TTL_MS..MAX_TTL_MS) {
            "ttlMs must be in [$MIN_TTL_MS, $MAX_TTL_MS]"
        }

        return NormalizedOnScreenLogSpec(
            text = spec.text ?: "Unavailable",
            template = spec.template,
            anchor = spec.anchor,
            textAlign = spec.textAlign,
            topOffsetDp = spec.topOffsetDp,
            edgeOffsetDp = spec.edgeOffsetDp,
            widthDp = spec.widthDp,
            fontSizeSp = spec.fontSizeSp,
            textColor = normalizeColor("textColor", spec.textColor),
            backgroundColor = normalizeColor("backgroundColor", spec.backgroundColor),
            ttlMs = spec.ttlMs,
        )
    }

    fun normalizeColor(
        fieldName: String,
        value: String,
    ): String {
        requireValidation(colorPattern.matches(value)) {
            "$fieldName must be exactly #RRGGBB or #AARRGGBB"
        }
        val uppercase = value.uppercase(Locale.ROOT)
        return if (uppercase.length == 7) {
            "#FF${uppercase.drop(1)}"
        } else {
            uppercase
        }
    }

    private fun validateText(text: String) {
        requireValidation(text.length in MIN_TEXT_LENGTH..MAX_TEXT_LENGTH) {
            "text must contain $MIN_TEXT_LENGTH..$MAX_TEXT_LENGTH UTF-16 code units"
        }
        requireValidation(text.any { !isContractWhitespace(it) }) {
            "text must include at least one non-whitespace character"
        }
        requireValidation(text.none(::isForbiddenControlCharacter)) {
            "text contains a control character other than LF or TAB"
        }
    }

    private fun isForbiddenControlCharacter(character: Char): Boolean =
            character != '\n' &&
            character != '\t' &&
            Character.getType(character) == Character.CONTROL.toInt()

    private fun validateRange(
        fieldName: String,
        value: Int,
        minimum: Int,
        maximum: Int,
    ) {
        requireValidation(value in minimum..maximum) {
            "$fieldName must be in [$minimum, $maximum]"
        }
    }

    private inline fun requireValidation(
        condition: Boolean,
        lazyMessage: () -> String,
    ) {
        if (!condition) {
            throw OnScreenLogValidationException(lazyMessage())
        }
    }
}

/** Stable action-result codes shared by the parser, renderer, and public execution result. */
object OnScreenLogErrorCodes {
    const val SERVICE_UNAVAILABLE = "ON_SCREEN_LOG_SERVICE_UNAVAILABLE"
    const val LAYOUT_INVALID = "ON_SCREEN_LOG_LAYOUT_INVALID"
    const val RENDER_FAILED = "ON_SCREEN_LOG_RENDER_FAILED"
    const val RENDER_TIMEOUT = "ON_SCREEN_LOG_RENDER_TIMEOUT"
}

/** Inclusive-exclusive physical screen rectangle in pixels. */
data class OnScreenLogBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    init {
        require(right >= left) { "right must be >= left" }
        require(bottom >= top) { "bottom must be >= top" }
    }

    val width: Int
        get() = right - left
    val height: Int
        get() = bottom - top

    fun toWireValue(): String = "[$left,$top][$right,$bottom]"
}

data class OnScreenLogPanelGeometry(
    val bounds: OnScreenLogBounds,
    val maxHeightPx: Int,
    val paddingPx: Int,
    val fontSizePx: Float,
)

/**
 * Pure layout math. Insets must already have been applied to [usableBounds] exactly once.
 */
object OnScreenLogGeometry {
    fun resolve(
        spec: NormalizedOnScreenLogSpec,
        density: Float,
        scaledDensity: Float,
        usableBounds: OnScreenLogBounds,
        completeTextLineHeightPx: Int,
    ): OnScreenLogPanelGeometry {
        require(density > 0f) { "density must be positive" }
        require(scaledDensity > 0f) { "scaledDensity must be positive" }
        require(completeTextLineHeightPx > 0) { "completeTextLineHeightPx must be positive" }

        val panelWidthPx = dpToPx(spec.widthDp, density)
        val edgeOffsetPx = dpToPx(spec.edgeOffsetDp, density)
        val topOffsetPx = dpToPx(spec.topOffsetDp, density)
        val paddingPx = dpToPx(OnScreenLogContract.PANEL_PADDING_DP, density)
        val left =
            when (spec.anchor) {
                OnScreenLogAnchor.Left -> usableBounds.left + edgeOffsetPx
                OnScreenLogAnchor.Right -> usableBounds.right - edgeOffsetPx - panelWidthPx
            }
        val top = usableBounds.top + topOffsetPx
        val right = left + panelWidthPx

        if (left < usableBounds.left || right > usableBounds.right) {
            throw OnScreenLogLayoutException("requested width exceeds the usable horizontal bounds")
        }

        val maxHeightPx = usableBounds.bottom - top
        val minimumHeightPx = completeTextLineHeightPx + (paddingPx * 2)
        if (maxHeightPx < minimumHeightPx) {
            throw OnScreenLogLayoutException("usable vertical space cannot contain one complete text line plus padding")
        }

        return OnScreenLogPanelGeometry(
            bounds = OnScreenLogBounds(left, top, right, top + maxHeightPx),
            maxHeightPx = maxHeightPx,
            paddingPx = paddingPx,
            fontSizePx = spec.fontSizeSp * scaledDensity,
        )
    }

    fun dpToPx(valueDp: Int, density: Float): Int = (valueDp * density).roundToInt()

    fun lineHeightPx(fontMetricsHeightPx: Float): Int = ceil(fontMetricsHeightPx).toInt()
}

/** Result supplied by the service-owned renderer to the normal UI action engine. */
sealed interface OnScreenLogControllerResult {
    data class Rendered(
        val spec: NormalizedOnScreenLogSpec,
        val bounds: OnScreenLogBounds,
        val truncated: Boolean,
    ) : OnScreenLogControllerResult

    data object Cleared : OnScreenLogControllerResult

    data class Failure(
        val errorCode: String,
        val message: String,
    ) : OnScreenLogControllerResult
}

/**
 * Action-engine seam for the service-owned renderer. It is not an ingress surface and does not
 * own an Android window itself.
 */
interface OnScreenLogController {
    suspend fun set(
        spec: OnScreenLogSpec,
        drawAcknowledgementTimeoutMs: Long = OnScreenLogContract.MAX_DRAW_ACKNOWLEDGEMENT_MS,
    ): OnScreenLogControllerResult

    suspend fun clear(): OnScreenLogControllerResult
}

/**
 * Test/default implementation for action-engine construction outside the Operator dependency
 * graph. Production binds the service-owned implementation from the Operator module.
 */
object OnScreenLogControllerNoOp : OnScreenLogController {
    override suspend fun set(
        spec: OnScreenLogSpec,
        drawAcknowledgementTimeoutMs: Long,
    ): OnScreenLogControllerResult =
        OnScreenLogControllerResult.Failure(
            errorCode = OnScreenLogErrorCodes.SERVICE_UNAVAILABLE,
            message = "The Operator accessibility service is not connected",
        )

    override suspend fun clear(): OnScreenLogControllerResult = OnScreenLogControllerResult.Cleared
}

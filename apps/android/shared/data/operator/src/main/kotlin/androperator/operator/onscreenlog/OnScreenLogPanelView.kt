package androperator.operator.onscreenlog

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.text.TextDirectionHeuristics
import android.view.View
import androperator.task.runner.NormalizedOnScreenLogSpec
import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogGeometry
import androperator.task.runner.OnScreenLogLayoutException
import androperator.task.runner.OnScreenLogPanelGeometry
import androperator.task.runner.OnScreenLogTextAlign

/** A noninteractive custom-drawn panel with no accessibility text descendants. */
internal open class OnScreenLogPanelView(
    context: Context,
) : View(context) {
    private var prepared: Prepared? = null
    private var generation: Long = Long.MIN_VALUE

    internal var lastDrawnGeneration: Long = Long.MIN_VALUE
        private set
    internal var onGenerationDrawn: ((Long) -> Unit)? = null

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        isClickable = false
        isFocusable = false
        isFocusableInTouchMode = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            importantForAutofill = IMPORTANT_FOR_AUTOFILL_NO
        }
        setWillNotDraw(false)
    }

    fun completeTextLineHeightPx(
        spec: NormalizedOnScreenLogSpec,
        scaledDensity: Float,
    ): Int {
        val paint = createTextPaint(spec, scaledDensity)
        val metrics = paint.fontMetricsInt
        return OnScreenLogGeometry.lineHeightPx((metrics.descent - metrics.ascent).toFloat())
    }

    fun prepare(
        spec: NormalizedOnScreenLogSpec,
        geometry: OnScreenLogPanelGeometry,
        content: OnScreenLogContent? = null,
    ): Prepared {
        val contentWidthPx = geometry.bounds.width - (geometry.paddingPx * 2)
        if (contentWidthPx <= 0) {
            throw OnScreenLogLayoutException("panel width cannot contain horizontal padding")
        }
        val maximumContentHeightPx = geometry.maxHeightPx - (geometry.paddingPx * 2)
        val paint = createTextPaint(spec, geometry.fontSizePx / spec.fontSizeSp)
        val text = content?.text ?: spec.text
        val fullLayout = createLayout(text, paint, contentWidthPx, spec.textAlign)
        val maximumLines = completeLineCount(fullLayout, maximumContentHeightPx)
        if (maximumLines < 1) {
            throw OnScreenLogLayoutException("usable vertical space cannot contain one complete text line plus padding")
        }

        val truncated = fullLayout.height > maximumContentHeightPx
        val textLayout =
            if (!truncated) {
                fullLayout
            } else {
                createTruncatedLayout(
                    text = text,
                    paint = paint,
                    contentWidthPx = contentWidthPx,
                    textAlign = spec.textAlign,
                    maximumLines = maximumLines,
                    fullLayout = fullLayout,
                )
            }
        val heightPx = geometry.paddingPx * 2 + textLayout.height
        if (heightPx > geometry.maxHeightPx) {
            throw OnScreenLogLayoutException("panel text cannot be truncated within the usable height")
        }

        return Prepared(
            textLayout = textLayout,
            textColor = Color.parseColor(spec.textColor),
            backgroundColor = Color.parseColor(spec.backgroundColor),
            paddingPx = geometry.paddingPx,
            widthPx = geometry.bounds.width,
            heightPx = heightPx,
            truncated = truncated || content?.truncated == true,
        )
    }

    fun apply(
        prepared: Prepared,
        generation: Long,
    ) {
        this.prepared = prepared
        this.generation = generation
        requestLayout()
        invalidate()
    }

    /** Used by controller tests to model the same callback emitted after [onDraw]. */
    internal fun acknowledgeDrawForTest() {
        notifyGenerationDrawn(generation)
    }

    override fun onMeasure(
        widthMeasureSpec: Int,
        heightMeasureSpec: Int,
    ) {
        val current = prepared
        if (current == null) {
            setMeasuredDimension(0, 0)
        } else {
            setMeasuredDimension(current.widthPx, current.heightPx)
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val current = prepared ?: return
        canvas.drawColor(current.backgroundColor)
        canvas.save()
        canvas.translate(current.paddingPx.toFloat(), current.paddingPx.toFloat())
        current.textLayout.draw(canvas)
        canvas.restore()
        notifyGenerationDrawn(generation)
    }

    private fun notifyGenerationDrawn(drawnGeneration: Long) {
        lastDrawnGeneration = drawnGeneration
        onGenerationDrawn?.invoke(drawnGeneration)
    }

    private fun createTextPaint(
        spec: NormalizedOnScreenLogSpec,
        scaledDensity: Float,
    ): TextPaint =
        TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            textSize = spec.fontSizeSp * scaledDensity
            color = Color.parseColor(spec.textColor)
        }

    private fun createLayout(
        text: CharSequence,
        paint: TextPaint,
        contentWidthPx: Int,
        textAlign: OnScreenLogTextAlign,
    ): StaticLayout =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            createLayoutApi23(
                text = text,
                paint = paint,
                contentWidthPx = contentWidthPx,
                textAlign = textAlign,
                maximumLines = null,
            )
        } else {
            createLayoutBeforeApi23(
                text = legacyLeftToRightText(text),
                paint = paint,
                contentWidthPx = contentWidthPx,
                textAlign = textAlign,
            )
        }

    private fun createTruncatedLayout(
        text: CharSequence,
        paint: TextPaint,
        contentWidthPx: Int,
        textAlign: OnScreenLogTextAlign,
        maximumLines: Int,
        fullLayout: StaticLayout,
    ): StaticLayout =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            createLayoutApi23(
                text = text,
                paint = paint,
                contentWidthPx = contentWidthPx,
                textAlign = textAlign,
                maximumLines = maximumLines,
            )
        } else {
            val displayText = legacyLeftToRightText(text)
            val finalVisibleLine = maximumLines - 1
            val prefixEnd = fullLayout.getLineStart(finalVisibleLine)
            val visibleLineEnd = fullLayout.getLineEnd(finalVisibleLine)
            val prefix = displayText.subSequence(0, prefixEnd)
            val finalLine = displayText.subSequence(prefixEnd, visibleLineEnd).trimEnd('\n', '\r')
            val ellipsizedFinalLine =
                TextUtils.ellipsize(android.text.SpannableStringBuilder(finalLine).append("…"), paint, contentWidthPx.toFloat(), TextUtils.TruncateAt.END)
            createLayoutBeforeApi23(
                text = android.text.SpannableStringBuilder(prefix).append(ellipsizedFinalLine),
                paint = paint,
                contentWidthPx = contentWidthPx,
                textAlign = textAlign,
            )
        }

    /**
     * API 21-22 lacks StaticLayout.Builder#setTextDirection. Prefixing each paragraph with an
     * invisible LRM keeps the requested left/right alignment physical rather than locale-relative.
     */
    private fun legacyLeftToRightText(text: CharSequence): CharSequence =
        android.text.SpannableStringBuilder().apply {
            append('\u200E')
            var start = 0
            text.forEachIndexed { index, character ->
                if (character == '\n') {
                    append(text, start, index + 1)
                    append('\u200E')
                    start = index + 1
                }
            }
            append(text, start, text.length)
        }

    @Suppress("DEPRECATION")
    private fun createLayoutBeforeApi23(
        text: CharSequence,
        paint: TextPaint,
        contentWidthPx: Int,
        textAlign: OnScreenLogTextAlign,
    ): StaticLayout =
        StaticLayout(
            text,
            0,
            text.length,
            paint,
            contentWidthPx,
            alignmentFor(textAlign),
            1f,
            0f,
            false,
        )

    private fun completeLineCount(
        layout: StaticLayout,
        maximumContentHeightPx: Int,
    ): Int {
        var completed = 0
        for (lineIndex in 0 until layout.lineCount) {
            if (layout.getLineBottom(lineIndex) > maximumContentHeightPx) {
                break
            }
            completed = lineIndex + 1
        }
        return completed
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.M)
    private fun createLayoutApi23(
        text: CharSequence,
        paint: TextPaint,
        contentWidthPx: Int,
        textAlign: OnScreenLogTextAlign,
        maximumLines: Int?,
    ): StaticLayout {
        val builder =
            StaticLayout.Builder
                .obtain(text, 0, text.length, paint, contentWidthPx)
                .setAlignment(alignmentFor(textAlign))
                .setTextDirection(TextDirectionHeuristics.LTR)
                .setIncludePad(false)
        if (maximumLines != null) {
            builder
                .setMaxLines(maximumLines)
                .setEllipsize(TextUtils.TruncateAt.END)
                .setEllipsizedWidth(contentWidthPx)
        }
        return builder.build()
    }

    private fun alignmentFor(textAlign: OnScreenLogTextAlign): Layout.Alignment =
        when (textAlign) {
            OnScreenLogTextAlign.Left -> Layout.Alignment.ALIGN_NORMAL
            OnScreenLogTextAlign.Right -> Layout.Alignment.ALIGN_OPPOSITE
        }

    internal data class Prepared(
        val textLayout: StaticLayout,
        val textColor: Int,
        val backgroundColor: Int,
        val paddingPx: Int,
        val widthPx: Int,
        val heightPx: Int,
        val truncated: Boolean,
    )
}

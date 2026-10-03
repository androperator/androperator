package androperator.operator.agent

import androperator.task.runner.OnScreenLogAnchor
import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogTextAlign
import androperator.task.runner.UiAction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentCommandParserOnScreenLogTest {
    private val parser = AgentCommandParserDefault()

    @Test
    fun `parse templates strictly without resolving or accepting both input forms`() {
        val action = parseSet("""{ "template": "{{foreground_app.icon}} {{device.model}}", "anchor": "right" }""")
        assertEquals("{{foreground_app.icon}} {{device.model}}", action.spec.template)
        assertEquals(null, action.spec.text)
        for (params in listOf("""{}""", """{"text":"x","template":"x"}""", """{"template":null}""",
            """{"template":1}""", """{"template":"{{unknown}}"}""", """{"template":" "}""")) {
            assertSetFailure(params)
        }
    }

    @Test
    fun `parse set_on_screen_log applies every default`() {
        val action = parseSet("""{ "text": "FLOW-001: Observe settings" }""")

        assertEquals("FLOW-001: Observe settings", action.spec.text)
        assertEquals(OnScreenLogAnchor.Left, action.spec.anchor)
        assertEquals(OnScreenLogTextAlign.Left, action.spec.textAlign)
        assertEquals(OnScreenLogContract.DEFAULT_TOP_OFFSET_DP, action.spec.topOffsetDp)
        assertEquals(OnScreenLogContract.DEFAULT_EDGE_OFFSET_DP, action.spec.edgeOffsetDp)
        assertEquals(OnScreenLogContract.DEFAULT_WIDTH_DP, action.spec.widthDp)
        assertEquals(OnScreenLogContract.DEFAULT_FONT_SIZE_SP, action.spec.fontSizeSp)
        assertEquals(OnScreenLogContract.DEFAULT_TEXT_COLOR, action.spec.textColor)
        assertEquals(OnScreenLogContract.DEFAULT_BACKGROUND_COLOR, action.spec.backgroundColor)
        assertEquals(OnScreenLogContract.DEFAULT_TTL_MS, action.spec.ttlMs)
    }

    @Test
    fun `parse set_on_screen_log accepts physical anchor and text alignment combinations`() {
        for (anchor in listOf("left", "right")) {
            for (textAlign in listOf("left", "right")) {
                val action = parseSet("""{ "text": "combination", "anchor": "$anchor", "textAlign": "$textAlign" }""")
                assertEquals(anchor, action.spec.anchor.wireValue)
                assertEquals(textAlign, action.spec.textAlign.wireValue)
            }
        }
    }

    @Test
    fun `parse set_on_screen_log accepts numeric boundaries including zero offsets`() {
        val boundaries =
            listOf(
                "topOffsetDp" to listOf(0, 1000),
                "edgeOffsetDp" to listOf(0, 1000),
                "widthDp" to listOf(80, 600),
                "fontSizeSp" to listOf(8, 24),
                "ttlMs" to listOf(1000, 3600000),
            )

        for ((field, values) in boundaries) {
            for (value in values) {
                parseSet("""{ "text": "boundary", "$field": $value }""")
            }
        }
    }

    @Test
    fun `parse set_on_screen_log accepts integral JSON number representations`() {
        val action =
            parseSet(
                """
                {
                  "text": "integral numbers",
                  "topOffsetDp": 1.0,
                  "edgeOffsetDp": 1e3,
                  "widthDp": 8e1,
                  "fontSizeSp": 8.0,
                  "ttlMs": 1e3
                }
                """.trimIndent(),
            )

        assertEquals(1, action.spec.topOffsetDp)
        assertEquals(1_000, action.spec.edgeOffsetDp)
        assertEquals(80, action.spec.widthDp)
        assertEquals(8, action.spec.fontSizeSp)
        assertEquals(1_000L, action.spec.ttlMs)
    }

    @Test
    fun `parse set_on_screen_log rejects invalid numeric forms and ranges`() {
        val invalidParams =
            listOf(
                """{ "text": "range", "topOffsetDp": -1 }""",
                """{ "text": "range", "topOffsetDp": 1001 }""",
                """{ "text": "range", "edgeOffsetDp": -1 }""",
                """{ "text": "range", "edgeOffsetDp": 1001 }""",
                """{ "text": "range", "widthDp": 79 }""",
                """{ "text": "range", "widthDp": 601 }""",
                """{ "text": "range", "fontSizeSp": 7 }""",
                """{ "text": "range", "fontSizeSp": 25 }""",
                """{ "text": "range", "ttlMs": 999 }""",
                """{ "text": "range", "ttlMs": 3600001 }""",
                """{ "text": "number", "topOffsetDp": "8" }""",
                """{ "text": "number", "edgeOffsetDp": 1.5 }""",
                """{ "text": "number", "widthDp": null }""",
                """{ "text": "number", "ttlMs": "1000" }""",
                """{ "text": "\uFEFF" }""",
            )

        invalidParams.forEach(::assertSetFailure)
    }

    @Test
    fun `parse set_on_screen_log rejects invalid text while allowing LF and TAB`() {
        assertSetFailure("{}")
        assertSetFailure("""{ "text": " \t\n " }""")
        assertSetFailure("""{ "text": "${"x".repeat(2049)}" }""")
        assertSetFailure("""{ "text": "line\rreturn" }""")
        assertSetFailure("""{ "text": "nul\u0000byte" }""")
        assertSetFailure("""{ "text": 42 }""")

        val accepted = parseSet("""{ "text": "one\n\ttwo" }""")
        assertEquals("one\n\ttwo", accepted.spec.text)
    }

    @Test
    fun `parse set_on_screen_log normalizes colors and rejects unsupported forms`() {
        val action =
            parseSet(
                """{ "text": "colors", "textColor": "#a1b2c3", "backgroundColor": "#7f0a0b0c" }""",
            )
        assertEquals("#FFA1B2C3", action.spec.textColor)
        assertEquals("#7F0A0B0C", action.spec.backgroundColor)

        listOf("red", "#12345", "#1234567", "#GG0000", "#FFFFFFFFF").forEach { color ->
            assertSetFailure("""{ "text": "bad color", "textColor": "$color" }""")
        }
    }

    @Test
    fun `parse set_on_screen_log rejects unknown and noncanonical fields`() {
        assertSetFailure("""{ "text": "unknown", "unknown": true }""")
        assertSetFailure("""{ "text": "retry", "retry": { "maxAttempts": 2 } }""")
        assertSetFailure("""{ "text": "alias", "text_align": "right" }""")
        assertSetFailure("""{ "value": "generic parameter alias" }""")
    }

    @Test
    fun `parse clear_on_screen_log accepts only omitted or empty params`() {
        val omitted = parseSingleAction("""{ "id": "clear", "type": "clear_on_screen_log" }""")
        val empty = parseSingleAction("""{ "id": "clear", "type": "clear_on_screen_log", "params": {} }""")

        assertIs<UiAction.ClearOnScreenLog>(omitted)
        assertIs<UiAction.ClearOnScreenLog>(empty)
        assertTrue(parser.parse(payloadFor("""{ "id": "clear", "type": "clear_on_screen_log", "params": { "text": "not allowed" } }""")).isFailure)
        assertTrue(parser.parse(payloadFor("""{ "id": "clear", "type": "clear_on_screen_log", "params": null }""")).isFailure)
    }

    @Test
    fun `parse rejects noncanonical on-screen-log action types`() {
        assertTrue(parser.parse(payloadFor("""{ "id": "set", "type": "on_screen_log", "params": { "text": "not canonical" } }""")).isFailure)
        assertTrue(parser.parse(payloadFor("""{ "id": "set", "type": "SET_ON_SCREEN_LOG", "params": { "text": "not canonical" } }""")).isFailure)
        assertTrue(parser.parse(payloadFor("""{ "id": "clear", "type": " clear_on_screen_log " }""")).isFailure)
    }

    private fun parseSet(paramsJson: String): UiAction.SetOnScreenLog =
        assertIs(
            parseSingleAction(
                """{ "id": "set", "type": "set_on_screen_log", "params": $paramsJson }""",
            ),
        )

    private fun assertSetFailure(paramsJson: String) {
        assertTrue(parser.parse(payloadFor("""{ "id": "set", "type": "set_on_screen_log", "params": $paramsJson }""")).isFailure)
    }

    private fun parseSingleAction(actionJson: String): UiAction =
        parser.parse(payloadFor(actionJson)).getOrThrow().actions.single()

    private fun payloadFor(actionJson: String): String =
        """
        {
          "commandId": "on-screen-log-command",
          "taskId": "on-screen-log-task",
          "source": "test",
          "actions": [$actionJson]
        }
        """.trimIndent()
}

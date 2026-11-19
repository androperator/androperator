package androperator.operator.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AgentCommandParserWallpaperTest {
    @Test
    fun `wallpaper preserves an explicit integer deadline and rejects malformed deadlines`() {
        val parser = AgentCommandParserDefault()
        val token = "a".repeat(32)
        val digest = "b".repeat(64)

        fun payload(timeout: String) = """
            {
              "commandId": "wallpaper-test",
              "taskId": "wallpaper-test",
              "source": "test",
              "timeoutMs": $timeout,
              "actions": [{
                "id": "set",
                "type": "set_wallpaper",
                "params": {"target": "both", "uploadToken": "$token", "sha256": "$digest"}
              }]
            }
        """.trimIndent()

        assertEquals(1_000L, parser.parse(payload("1000")).getOrThrow().timeoutMs)
        assertEquals(45_000L, parser.parse(payload("45000")).getOrThrow().timeoutMs)
        for (timeout in listOf("1000.5", "null", "\"1000\"", "999", "45001")) {
            assertTrue(parser.parse(payload(timeout)).isFailure, timeout)
        }
    }
}

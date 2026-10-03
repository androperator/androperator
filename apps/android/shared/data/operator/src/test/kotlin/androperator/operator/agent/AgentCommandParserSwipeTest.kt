package androperator.operator.agent

import action.math.geometry.Point
import androperator.task.runner.UiAction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentCommandParserSwipeTest {
    private fun parse(params: String) = AgentCommandParserDefault().parse(
        """{"commandId":"swipe-test","taskId":"swipe-task","source":"test","actions":[{"id":"swipe","type":"swipe","params":$params}]}""",
    )

    @Test
    fun `swipe preserves endpoints and explicit duration`() {
        for (duration in listOf(1, 300, 10000)) {
            val action = assertIs<UiAction.Swipe>(parse("""{"start":{"x":0,"y":200},"end":{"x":300,"y":200},"durationMs":$duration}""").getOrThrow().actions.single())
            assertEquals(Point(0, 200), action.start)
            assertEquals(Point(300, 200), action.end)
            assertEquals(duration.toLong(), action.durationMs)
        }
    }

    @Test
    fun `swipe rejects missing invalid and extra parameters`() {
        val start = """"start":{"x":0,"y":200}"""
        val end = """"end":{"x":300,"y":200}"""
        val invalid = listOf(
            "{}", "{$start,$end}", "{$start,\"durationMs\":300}",
            "{$start,$end,\"durationMs\":300,\"retry\":{}}",
            """{"start":{"x":0,"y":200},"end":{"x":0,"y":200},"durationMs":300}""",
        ) + listOf("null", "0", "-1", "10001", "1.5", "\"300\"").map { "{$start,$end,\"durationMs\":$it}" } +
            listOf("null", "{}", "{\"x\":-1,\"y\":0}", "{\"x\":1.5,\"y\":0}", "{\"x\":\"1\",\"y\":0}", "{\"x\":2147483648,\"y\":0}", "{\"x\":0,\"y\":0,\"z\":1}").map { "{\"start\":$it,$end,\"durationMs\":300}" }
        for (params in invalid) assertTrue(parse(params).isFailure, params)
    }
}

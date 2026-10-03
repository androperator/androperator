package androperator.operator.agent

import action.math.geometry.Point
import androperator.task.runner.UiAction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentCommandParserDragTest {
    private fun parse(params: String) = AgentCommandParserDefault().parse(
        """{"commandId":"drag-test","taskId":"drag-task","source":"test","actions":[{"id":"drag","type":"drag","params":$params}]}""",
    )

    @Test
    fun `drag preserves endpoints and explicit duration`() {
        for (duration in listOf(1, 300, 10000)) {
            val action = assertIs<UiAction.Drag>(parse("""{"start":{"x":0,"y":200},"end":{"x":300,"y":200},"holdDurationMs":1000,"moveDurationMs":$duration}""").getOrThrow().actions.single())
            assertEquals(Point(0, 200), action.start)
            assertEquals(Point(300, 200), action.end)
            assertEquals(duration.toLong(), action.moveDurationMs)
            assertEquals(1000L, action.holdDurationMs)
        }
    }

    @Test
    fun `drag rejects missing invalid and extra parameters`() {
        val start = """"start":{"x":0,"y":200}"""
        val end = """"end":{"x":300,"y":200}"""
        val invalid = listOf(
            "{}", "{$start,$end}", "{$start,$end,\"holdDurationMs\":1000}", "{$start,$end,\"moveDurationMs\":300}", "{$start,\"holdDurationMs\":1000,\"moveDurationMs\":300}",
            "{$start,$end,\"holdDurationMs\":1000,\"moveDurationMs\":300,\"retry\":{}}",
            """{"start":{"x":0,"y":200},"end":{"x":0,"y":200},"holdDurationMs":1000,"moveDurationMs":300}""",
        ) + listOf("null", "0", "-1", "10001", "1.5", "\"300\"").map { "{$start,$end,\"holdDurationMs\":1000,\"moveDurationMs\":$it}" } +
            listOf("null", "{}", "{\"x\":-1,\"y\":0}", "{\"x\":1.5,\"y\":0}", "{\"x\":\"1\",\"y\":0}", "{\"x\":2147483648,\"y\":0}", "{\"x\":0,\"y\":0,\"z\":1}").map { "{\"start\":$it,$end,\"holdDurationMs\":1000,\"moveDurationMs\":300}" }
        for (params in invalid) assertTrue(parse(params).isFailure, params)
        for (value in listOf("null", "0", "-1", "10001", "1.5", "\"1000\"")) {
            assertTrue(parse("{$start,$end,\"holdDurationMs\":$value,\"moveDurationMs\":300}").isFailure)
        }
    }
}

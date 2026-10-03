package androperator.operator.agent

import androperator.task.runner.UiAction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentCommandParserQueryTest {
    private fun parse(
        params: String,
        type: String = "query_ui",
    ) = AgentCommandParserDefault().parse(
        """{"commandId":"query-test","taskId":"query-task","source":"test","actions":[{"id":"query","type":"$type","params":$params}]}""",
    )

    @Test
    fun `query defaults and relational action matchers are parsed`() {
        val defaults = assertIs<UiAction.QueryUi>(parse("{}").getOrThrow().actions.single())
        assertEquals(null, defaults.matcher)
        assertEquals("on_screen", defaults.visibility)
        assertEquals(100, defaults.limit)
        val params = """{"matcher":{"resourceId":"row","ancestor":{"role":"list"},"descendant":{"textEquals":"Unique"}}}"""
        val query = assertIs<UiAction.QueryUi>(parse(params).getOrThrow().actions.single())
        val click = assertIs<UiAction.Click>(parse(params, "click").getOrThrow().actions.single())
        assertEquals(query.matcher, click.matcher)
        assertEquals("Unique", query.matcher?.descendant?.textEquals)
        val blankLabel = assertIs<UiAction.QueryUi>(parse("""{"matcher":{"role":"switch","textEquals":""}}""").getOrThrow().actions.single())
        assertEquals("", blankLabel.matcher?.textEquals)
        assertEquals("switch", blankLabel.matcher?.role)
        for (limit in listOf(1, 1000)) {
            val action = assertIs<UiAction.QueryUi>(parse("""{"visibility":"all","limit":$limit}""").getOrThrow().actions.single())
            assertEquals(limit, action.limit)
            assertEquals("all", action.visibility)
        }
    }

    @Test
    fun `query rejects invalid values and empty or nested predicates`() {
        val invalid =
            listOf(
                """{"matcher":{}}""",
                """{"matcher":null}""",
                """{"matcher":[]}""",
                """{"matcher":{"textEquals":" "}}""",
                """{"matcher":{"textEquals":false}}""",
                """{"matcher":{"textEquals":null}}""",
                """{"matcher":{"unknown":"x"}}""",
                """{"matcher":{"ancestor":{}}}""",
                """{"matcher":{"descendant":{"ancestor":{"textEquals":"x"}}}}""",
                """{"matcher":{"ancestor":{"textEquals":""}}}""",
                """{"matcher":{"descendant":false}}""",
                """{"limit":0}""",
                """{"limit":1001}""",
                """{"limit":1.5}""",
                """{"limit":"1"}""",
                """{"limit":null}""",
                """{"visibility":"hidden"}""",
                """{"visibility":null}""",
                """{"visibility":1}""",
                """{"strict":true}""",
            )
        for (params in invalid) assertTrue(parse(params).isFailure, params)
    }
}

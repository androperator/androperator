package androperator.operator.agent

import androperator.task.runner.UiAction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AgentCommandParserStrictTest {
    private fun parse(type: String, strict: String?, container: String = """{"resourceId":"scope","descendant":{"textEquals":"Child"}}""") =
        AgentCommandParserDefault().parse("""{"commandId":"strict-test","taskId":"task","source":"test","actions":[{"id":"step","type":"$type","params":{"matcher":{"resourceId":"target"},"text":"value","container":$container${strict?.let { ",\"strict\":$it" } ?: ""}}}]}""")

    @Test fun `all target actions parse booleans and scoped relationships`() {
        for (type in listOf("click", "enter_text", "read_text", "wait_for_node", "scroll", "scroll_until", "scroll_and_click")) {
            for (strict in listOf(null, "false", "true")) {
                val action = parse(type, strict).getOrThrow().actions.single()
                val selection = when (action) {
                    is UiAction.Click -> action.strict to action.container
                    is UiAction.EnterText -> action.strict to action.container
                    is UiAction.ReadText -> action.strict to action.container
                    is UiAction.WaitForNode -> action.strict to action.container
                    is UiAction.Scroll -> action.strict to action.container
                    is UiAction.ScrollUntil -> action.strict to action.container
                    is UiAction.ScrollAndClick -> action.strict to action.container
                    else -> error("unexpected action")
                }
                assertEquals(strict == "true", selection.first)
                assertEquals("Child", selection.second?.descendant?.textEquals)
            }
            for (invalid in listOf("null", "1", "\"true\"", "{}", "[]")) assertTrue(parse(type, invalid).isFailure, "$type $invalid")
            for (invalid in listOf("null", "{}", "[]", "\"scope\"", """{"ancestor":{}}""")) assertTrue(parse(type, "true", invalid).isFailure)
        }
    }

    @Test fun `coordinate click rejects strict selection`() {
        val result = AgentCommandParserDefault().parse("""{"commandId":"strict-test","taskId":"task","source":"test","actions":[{"id":"step","type":"click","params":{"coordinate":{"x":1,"y":1},"strict":true}}]}""")
        assertTrue(result.isFailure)
    }
}

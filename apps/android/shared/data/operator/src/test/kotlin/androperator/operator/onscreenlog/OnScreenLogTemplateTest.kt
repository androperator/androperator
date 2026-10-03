package androperator.operator.onscreenlog

import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogSpec
import androperator.task.runner.OnScreenLogTemplate
import androperator.task.runner.OnScreenLogValidationException
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class OnScreenLogTemplateTest {
    @Test
    fun `shared grammar fixtures agree with Node`() {
        val root = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .first { File(it, "validation/on-screen-logs/template-fixtures.json").exists() }
        val fixtures = Json.parseToJsonElement(File(root, "validation/on-screen-logs/template-fixtures.json").readText()).jsonObject
        fixtures.getValue("valid").jsonArray.forEach {
            OnScreenLogContract.normalize(OnScreenLogSpec(template = it.jsonPrimitive.content))
        }
        fixtures.getValue("invalid").jsonArray.forEach {
            assertFailsWith<OnScreenLogValidationException> {
                OnScreenLogContract.normalize(OnScreenLogSpec(template = it.jsonPrimitive.content))
            }
        }
        assertEquals("{{foreground_app.icon}}", OnScreenLogTemplate.parse("{{{{foreground_app.icon}}}}").single().literal)
    }

    @Test
    fun `input exclusivity and limits preserve literal behavior`() {
        for (spec in listOf(OnScreenLogSpec(), OnScreenLogSpec(text = "x", template = "x"),
            OnScreenLogSpec(template = ""), OnScreenLogSpec(template = " \n"),
            OnScreenLogSpec(template = "x".repeat(2049)), OnScreenLogSpec(template = "\u0000"))) {
            assertFailsWith<OnScreenLogValidationException> { OnScreenLogContract.normalize(spec) }
        }
        assertEquals("{{unknown}}", OnScreenLogContract.normalize(OnScreenLogSpec(text = "{{unknown}}")).text)
    }
}

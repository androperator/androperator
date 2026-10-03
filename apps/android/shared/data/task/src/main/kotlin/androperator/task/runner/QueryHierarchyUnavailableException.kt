package androperator.task.runner

import androperator.uitree.UiHierarchyDiagnostics
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class QueryHierarchyUnavailableException(
    val diagnostics: UiHierarchyDiagnostics,
    val code: String = "UI_TREE_UNAVAILABLE",
) : IllegalStateException("UI hierarchy is unavailable from the accessibility service") {
    fun stepData(): Map<String, String> = mapOf(
        "errorCode" to code,
        "error" to message.orEmpty(),
        "diagnostics" to Json { encodeDefaults = true }.encodeToString(diagnostics),
    )
}

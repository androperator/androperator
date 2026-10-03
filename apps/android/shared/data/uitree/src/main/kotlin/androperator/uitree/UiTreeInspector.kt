package androperator.uitree

interface UiTreeInspector {
    suspend fun getCurrentUiElements(): List<UiTreeElement>

    suspend fun getCurrentUiTree(): UiTree?

    /** Best-effort evidence after a capture returned no root; never selects another window. */
    suspend fun getUnavailableHierarchyDiagnostics(): UiHierarchyDiagnostics = UiHierarchyDiagnostics()

    suspend fun getCurrentWindowMetadata(): UiWindowMetadata?

    /**
     * Returns a UI hierarchy dump that mirrors Android's `uiautomator dump` node structure.
     */
    suspend fun getCurrentUiHierarchyDump(): String?
}

@kotlinx.serialization.Serializable
data class UiHierarchyDiagnostics(
    val serviceAvailable: Boolean? = null,
    val rootAvailable: Boolean = false,
    val windowCount: Int? = null,
    val foregroundPackage: String? = null,
)

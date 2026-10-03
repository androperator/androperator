package androperator.uitree

class UiTreeInspectorNoOp : UiTreeInspector {
    override suspend fun getCurrentUiElements(): List<UiTreeElement> = emptyList()

    override suspend fun getCurrentUiTree(): UiTree? = null

    override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null

    override suspend fun getCurrentUiHierarchyDump(): String? = null
}

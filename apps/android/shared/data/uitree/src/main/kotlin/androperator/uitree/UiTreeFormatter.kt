package androperator.uitree

/**
 * Interface for formatting UiTree objects into different output formats.
 * Used for LLM prompts, debugging, and visualization.
 */
interface UiTreeFormatter {
    /**
     * Formats the UiTree as an ASCII tree representation.
     * Suitable for console output and LLM prompts.
     */
    fun toAsciiTree(
        tree: UiTree,
        // presentation controls (function params, not constructor args)
        maxDepth: Int = 64,
        omitRedundant: Boolean = true,
        showTreeIndex: Boolean = false,
        showId: Boolean = false,
        showClickable: Boolean = true,
        // if provided, each node's id is looked up to print [#index]
        indexMap: Map<UiNodeId, Int>? = null,
    ): String

    /**
     * Formats the UiTree as JSON string.
     * Uses kotlinx serialization for complete structured output.
     */
    fun toJson(tree: UiTree): String
}

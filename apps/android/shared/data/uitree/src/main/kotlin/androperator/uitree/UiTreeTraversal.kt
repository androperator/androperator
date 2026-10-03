package androperator.uitree

/**
 * Utilities for traversing UiTree structures.
 * Provides DFS ordering that matches the flat element enumeration.
 */
object UiTreeTraversal {
    /**
     * Builds a stable DFS index map for UiTree nodes.
     * The index corresponds to the order in which nodes would appear
     * in a depth-first traversal (same as flat element enumeration).
     */
    fun buildIndexMap(root: UiNode): Map<UiNodeId, Int> {
        val map = LinkedHashMap<UiNodeId, Int>()
        var i = 0

        fun dfs(node: UiNode) {
            map[node.id] = i++
            node.children.forEach(::dfs)
        }

        dfs(root)
        return map
    }

    // --- Node Search Methods ---

    /**
     * Finds the first UiNode in the tree that matches the given predicate.
     * Searches in depth-first order.
     */
    fun findFirst(
        tree: UiTree,
        predicate: (UiNode) -> Boolean,
    ): UiNode? {
        fun dfs(node: UiNode): UiNode? {
            if (predicate(node)) return node
            for (child in node.children) {
                val result = dfs(child)
                if (result != null) return result
            }
            return null
        }
        return dfs(tree.root)
    }

    /**
     * Finds all UiNodes in the tree that match the given predicate.
     * Returns results in depth-first order.
     */
    fun findAll(
        tree: UiTree,
        predicate: (UiNode) -> Boolean,
    ): List<UiNode> {
        val results = mutableListOf<UiNode>()

        fun dfs(node: UiNode) {
            if (predicate(node)) results.add(node)
            node.children.forEach(::dfs)
        }
        dfs(tree.root)
        return results
    }

    /**
     * Finds the first UiNode with the specified resourceId.
     */
    fun findByResourceId(
        tree: UiTree,
        resourceId: String,
    ): UiNode? = findFirst(tree) { it.resourceId == resourceId }

    /**
     * Finds the first UiNode with the exact label.
     */
    fun findByLabel(
        tree: UiTree,
        label: String,
    ): UiNode? = findFirst(tree) { it.label == label }

    /**
     * Finds the first UiNode whose label starts with the given prefix.
     */
    fun findByLabelPrefix(
        tree: UiTree,
        prefix: String,
    ): UiNode? = findFirst(tree) { it.label.startsWith(prefix) }

    /**
     * Finds the first UiNode that matches all the specified criteria.
     * Pass null for criteria you don't want to check.
     */
    fun findFirstBy(
        tree: UiTree,
        resourceId: String? = null,
        label: String? = null,
        labelPrefix: String? = null,
        className: String? = null,
        isClickable: Boolean? = null,
        isEnabled: Boolean? = null,
        isVisible: Boolean? = null,
    ): UiNode? =
        findFirst(tree) { node ->
            (resourceId == null || node.resourceId == resourceId) &&
                (label == null || node.label == label) &&
                (labelPrefix == null || node.label.startsWith(labelPrefix)) &&
                (className == null || node.className == className) &&
                (isClickable == null || node.isClickable == isClickable) &&
                (isEnabled == null || node.isEnabled == isEnabled) &&
                (isVisible == null || node.isVisible == isVisible)
        }

    /**
     * Finds all UiNodes that match all the specified criteria.
     * Pass null for criteria you don't want to check.
     */
    fun findAllBy(
        tree: UiTree,
        resourceId: String? = null,
        label: String? = null,
        labelPrefix: String? = null,
        className: String? = null,
        isClickable: Boolean? = null,
        isEnabled: Boolean? = null,
        isVisible: Boolean? = null,
    ): List<UiNode> =
        findAll(tree) { node ->
            (resourceId == null || node.resourceId == resourceId) &&
                (label == null || node.label == label) &&
                (labelPrefix == null || node.label.startsWith(labelPrefix)) &&
                (className == null || node.className == className) &&
                (isClickable == null || node.isClickable == isClickable) &&
                (isEnabled == null || node.isEnabled == isEnabled) &&
                (isVisible == null || node.isVisible == isVisible)
        }
}

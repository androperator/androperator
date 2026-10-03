package androperator.task.runner

/**
 * Flexible matcher for UI node selection with chaining support.
 * Allows matching nodes based on multiple criteria with AND semantics by default.
 */
data class NodeMatcher(
    val resourceId: String? = null,
    val role: String? = null,
    val textEquals: String? = null,
    val textContains: String? = null,
    val contentDescEquals: String? = null,
    val contentDescContains: String? = null,
    val ancestor: NodePredicate? = null,
    val descendant: NodePredicate? = null,
) {
    /**
     * Checks scalar fields only. Tree relationships are evaluated by NodeResolver.
     */
    fun matches(node: TaskUiNode): Boolean = NodePredicate(resourceId, role, textEquals, textContains, contentDescEquals, contentDescContains).matches(node)
}

data class NodePredicate(
    val resourceId: String? = null,
    val role: String? = null,
    val textEquals: String? = null,
    val textContains: String? = null,
    val contentDescEquals: String? = null,
    val contentDescContains: String? = null,
) {
    /**
     * Checks if this matcher matches the given TaskUiNode.
     * Returns false as soon as any condition fails (short-circuit evaluation).
     */
    fun matches(node: TaskUiNode): Boolean {
        if (resourceId != null && node.resourceId != resourceId) return false
        if (role != null && node.role?.equals(role, ignoreCase = true) != true) return false
        if (textEquals != null && node.label != textEquals) return false
        if (textContains != null && !node.label.contains(textContains, ignoreCase = true)) return false
        if (contentDescEquals != null && node.contentDescription != contentDescEquals) return false
        if (contentDescContains != null && node.contentDescription?.contains(contentDescContains, ignoreCase = true) != true) return false
        return true
    }
}

/**
 * Builder class for creating NodeMatcher instances using DSL syntax.
 * Provides fluent API for building matchers with multiple conditions.
 */
class NodeMatcherBuilder {
    private var resourceId: String? = null
    private var role: String? = null
    private var textEquals: String? = null
    private var textContains: String? = null
    private var contentDescEquals: String? = null
    private var contentDescContains: String? = null

    fun resourceId(id: String) {
        resourceId = id
    }

    fun role(role: String) {
        this.role = role
    }

    fun textEquals(text: String) {
        textEquals = text
    }

    fun textContains(text: String) {
        textContains = text
    }

    fun contentDescEquals(text: String) {
        contentDescEquals = text
    }

    fun contentDescContains(text: String) {
        contentDescContains = text
    }

    fun build(): NodeMatcher =
        NodeMatcher(
            resourceId = resourceId,
            role = role,
            textEquals = textEquals,
            textContains = textContains,
            contentDescEquals = contentDescEquals,
            contentDescContains = contentDescContains,
        )
}

/**
 * DSL entry point for creating NodeMatcher instances.
 * Usage: nodeMatcher { resourceId("id") role("button") textContains("search") }
 */
fun nodeMatcher(block: NodeMatcherBuilder.() -> Unit): NodeMatcher = NodeMatcherBuilder().apply(block).build()

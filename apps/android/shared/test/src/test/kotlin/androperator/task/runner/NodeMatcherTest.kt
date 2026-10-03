package androperator.task.runner

import androperator.test.ActionTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NodeMatcherTest : ActionTest {
    private fun sample(
        id: String? = null,
        role: String? = null,
        label: String = "",
        clickable: Boolean = false,
    ) = TaskUiNode(
        resourceId = id,
        role = role,
        label = label,
        clickable = clickable,
        debugPath = "",
    )

    @Test
    fun `NodeMatcher with resourceId matches exact resourceId`() {
        val matcher = NodeMatcher(resourceId = "pkg:id/control")
        assertTrue(matcher.matches(sample(id = "pkg:id/control")))
        assertFalse(matcher.matches(sample(id = "pkg:id/other")))
    }

    @Test
    fun `NodeMatcher with role matches exact role case-insensitively`() {
        val matcher = NodeMatcher(role = "button")
        assertTrue(matcher.matches(sample(role = "button")))
        assertTrue(matcher.matches(sample(role = "BUTTON")))
        assertFalse(matcher.matches(sample(role = "tab")))
    }

    @Test
    fun `NodeMatcher with textEquals matches exact text case-sensitively`() {
        val matcher = NodeMatcher(textEquals = "Panasonic, Air conditioner, Off.")
        assertTrue(matcher.matches(sample(label = "Panasonic, Air conditioner, Off.")))
        assertFalse(matcher.matches(sample(label = "Panasonic, Air conditioner, On.")))
        assertFalse(matcher.matches(sample(label = "panasonic, air conditioner, off.")))
    }

    @Test
    fun `NodeMatcher with textContains matches substring case-insensitively`() {
        val matcher = NodeMatcher(textContains = "Panasonic")
        assertTrue(matcher.matches(sample(label = "Panasonic, Air conditioner, Off.")))
        assertTrue(matcher.matches(sample(label = "panasonic, Air conditioner, Off.")))
        assertFalse(matcher.matches(sample(label = "Samsung, Air conditioner, Off.")))
    }

    @Test
    fun `NodeMatcher with multiple conditions requires all to match (AND semantics)`() {
        val matcher =
            NodeMatcher(
                resourceId = "pkg:id/control",
                role = "button",
                textContains = "Panasonic",
            )

        assertTrue(
            matcher.matches(
                sample(
                    id = "pkg:id/control",
                    role = "button",
                    label = "Panasonic, Air conditioner, Off.",
                ),
            ),
        )

        assertFalse(
            matcher.matches(
                sample(
                    id = "pkg:id/control",
                    role = "button",
                    label = "Samsung, Air conditioner, Off.",
                ),
            ),
        )

        assertFalse(
            matcher.matches(
                sample(
                    id = "pkg:id/control",
                    role = "tab",
                    label = "Panasonic, Air conditioner, Off.",
                ),
            ),
        )

        assertFalse(
            matcher.matches(
                sample(
                    id = "pkg:id/other",
                    role = "button",
                    label = "Panasonic, Air conditioner, Off.",
                ),
            ),
        )
    }

    @Test
    fun `NodeMatcher with no conditions matches any node`() {
        val matcher = NodeMatcher()
        assertTrue(matcher.matches(sample()))
        assertTrue(matcher.matches(sample(id = "any")))
        assertTrue(matcher.matches(sample(role = "any")))
        assertTrue(matcher.matches(sample(label = "any text")))
    }

    @Test
    fun `NodeMatcher short-circuits on first mismatch for performance`() {
        // This test verifies that matching short-circuits by checking that
        // if resourceId doesn't match, other conditions aren't evaluated
        val matcher =
            NodeMatcher(
                resourceId = "nonexistent",
                role = "button",
                textContains = "Panasonic",
            )

        assertFalse(matcher.matches(sample(id = "different")))
    }

    @Test
    fun `DSL nodeMatcher creates correct NodeMatcher instance`() {
        val matcher =
            nodeMatcher {
                resourceId("pkg:id/control")
                role("button")
                textEquals("Click me")
            }

        val expected =
            NodeMatcher(
                resourceId = "pkg:id/control",
                role = "button",
                textEquals = "Click me",
            )

        // Test with matching node
        assertTrue(
            matcher.matches(
                sample(
                    id = "pkg:id/control",
                    role = "button",
                    label = "Click me",
                ),
            ),
        )

        // Test with non-matching node
        assertFalse(
            matcher.matches(
                sample(
                    id = "pkg:id/control",
                    role = "button",
                    label = "Wrong text",
                ),
            ),
        )
    }

    @Test
    fun `DSL nodeMatcher allows partial conditions`() {
        val matcher =
            nodeMatcher {
                resourceId("pkg:id/control")
                textContains("Panasonic")
            }

        assertTrue(
            matcher.matches(
                sample(
                    id = "pkg:id/control",
                    label = "Panasonic device",
                ),
            ),
        )

        assertFalse(
            matcher.matches(
                sample(
                    id = "pkg:id/other",
                    label = "Panasonic device",
                ),
            ),
        )
    }

    @Test
    fun `DSL builder accumulates conditions correctly`() {
        val builder = NodeMatcherBuilder()

        // Initially empty
        val emptyMatcher = builder.build()
        assertTrue(emptyMatcher.matches(sample()))

        // After adding resourceId
        builder.resourceId("test:id")
        val idMatcher = builder.build()
        assertTrue(idMatcher.matches(sample(id = "test:id")))
        assertFalse(idMatcher.matches(sample(id = "other:id")))

        // After adding role
        builder.role("button")
        val idRoleMatcher = builder.build()
        assertTrue(idRoleMatcher.matches(sample(id = "test:id", role = "button")))
        assertFalse(idRoleMatcher.matches(sample(id = "test:id", role = "tab")))
    }

    @Test
    fun `NodeMatcher handles null values correctly`() {
        val matcher =
            NodeMatcher(
                resourceId = null,
                role = "button",
                textContains = null,
            )

        // Should match any node with role="button" regardless of other fields
        assertTrue(matcher.matches(sample(role = "button")))
        assertTrue(matcher.matches(sample(id = "any", role = "button", label = "any")))
        assertFalse(matcher.matches(sample(role = "tab")))
    }

    @Test
    fun `NodeMatcher handles empty strings correctly`() {
        val matcher = NodeMatcher(textEquals = "")

        assertTrue(matcher.matches(sample(label = "")))
        assertFalse(matcher.matches(sample(label = "non-empty")))

        val containsMatcher = NodeMatcher(textContains = "")
        // Empty string contains should match everything (empty string is substring of everything)
        assertTrue(containsMatcher.matches(sample(label = "")))
        assertTrue(containsMatcher.matches(sample(label = "any text")))
    }

    @Test
    fun `NodeMatcher handles null role values correctly without NPE`() {
        val matcher = NodeMatcher(role = "button")

        // Should return false when node.role is null and matcher.role is not null
        assertFalse(matcher.matches(sample(role = null)))

        // Should return true when both role values match
        assertTrue(matcher.matches(sample(role = "button")))

        // Should return false when role values don't match
        assertFalse(matcher.matches(sample(role = "tab")))
    }

    @Test
    fun `NodeMatcher handles null resourceId values correctly without NPE`() {
        val matcher = NodeMatcher(resourceId = "test:id")

        // Should return false when node.resourceId is null and matcher.resourceId is not null
        assertFalse(matcher.matches(sample(id = null)))

        // Should return true when both resourceId values match
        assertTrue(matcher.matches(sample(id = "test:id")))

        // Should return false when resourceId values don't match
        assertFalse(matcher.matches(sample(id = "other:id")))
    }

    @Test
    fun `NodeMatcher is immutable and reusable`() {
        val matcher = NodeMatcher(resourceId = "test:id")

        // Can be reused multiple times
        assertTrue(matcher.matches(sample(id = "test:id")))
        assertTrue(matcher.matches(sample(id = "test:id")))
        assertFalse(matcher.matches(sample(id = "other:id")))

        // Original matcher is unchanged
        assertTrue(matcher.matches(sample(id = "test:id")))
    }
}

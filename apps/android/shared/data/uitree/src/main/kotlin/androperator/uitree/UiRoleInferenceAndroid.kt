package androperator.uitree

import android.view.accessibility.AccessibilityNodeInfo

/**
 * Utility object for inferring semantic UI roles from Android AccessibilityNodeInfo.
 * Uses heuristics based on class names, accessibility properties, and node characteristics.
 */
object UiRoleInference {
    /**
     * Infers the semantic role of a UI element from its accessibility properties.
     */
    fun inferRole(
        className: String,
        isClickable: Boolean,
        hasText: Boolean,
        contentDesc: String?,
        node: AccessibilityNodeInfo,
        parentClassName: String? = null,
        parentResourceId: String? = null,
    ): UiRole {
        // Special case: Tab children in TabLayout/BottomNavigationView
        if (isTabChild(className, parentClassName, parentResourceId, hasText)) {
            return UiRole.Tab
        }

        // Class name mapping (highest priority)
        when {
            // Pager components
            className.contains("ViewPager", ignoreCase = true) ||
                className.contains("ViewPager2", ignoreCase = true) -> return UiRole.Pager

            // Interactive controls
            className.contains("Button", ignoreCase = true) ||
                className.contains("MaterialButton", ignoreCase = true) -> return UiRole.Button

            className.contains("EditText", ignoreCase = true) ||
                className.contains("TextInputEditText", ignoreCase = true) ||
                className.contains("AutoCompleteTextView", ignoreCase = true) -> return UiRole.TextField

            className.contains("Switch", ignoreCase = true) -> return UiRole.Switch
            className.contains("CheckBox", ignoreCase = true) -> return UiRole.Checkbox
            className.contains("RadioButton", ignoreCase = true) -> return UiRole.Radio
            className.contains("ToggleButton", ignoreCase = true) -> return UiRole.Toggle

            // Collection views
            className.contains("RecyclerView", ignoreCase = true) -> {
                return if (isGridLayout(node)) UiRole.Grid else UiRole.List
            }
            className.contains("ListView", ignoreCase = true) -> return UiRole.List
            className.contains("GridView", ignoreCase = true) -> return UiRole.Grid

            // Navigation elements
            className.contains("Toolbar", ignoreCase = true) -> return UiRole.Toolbar
            className.contains("TabLayout", ignoreCase = true) ||
                className.contains("BottomNavigationView", ignoreCase = true) -> return UiRole.TabBar

            // Visual elements
            className.contains("ImageView", ignoreCase = true) -> {
                return if (isClickable) UiRole.Icon else UiRole.Image
            }

            className.contains("Chip", ignoreCase = true) -> return UiRole.Chip
        }

        // Accessibility semantics (medium priority)
        if (node.collectionItemInfo != null) {
            return UiRole.ListItem
        }

        if (node.isHeading && hasText) {
            return UiRole.Title
        }

        // Layout containers (lower priority)
        when {
            className.contains("LinearLayout", ignoreCase = true) ||
                className.contains("FrameLayout", ignoreCase = true) ||
                className.contains("ConstraintLayout", ignoreCase = true) ||
                className.contains("CoordinatorLayout", ignoreCase = true) -> {
                return inferContainerRole(node)
            }
        }

        // Heuristic fallbacks
        return when {
            // Clickable with minimal text and drawable-like class -> Icon
            isClickable && !hasText && isLikelyIcon(className) -> UiRole.Icon

            // Has text and not interactive -> Text/Label/Title
            hasText && !isClickable -> {
                when {
                    isLikelyTitle(node, parentClassName) -> UiRole.Title
                    isLikelyLabel(node) -> UiRole.Label
                    else -> UiRole.Text
                }
            }

            // Clickable with text -> Button (but avoid over-converting long text)
            isClickable && hasText -> {
                if (isLikelyLongTextContent(node)) UiRole.Text else UiRole.Button
            }

            // Default fallback
            else -> UiRole.Unknown
        }
    }

    /**
     * Extracts hints about the element's state and properties.
     */
    fun extractHints(node: AccessibilityNodeInfo): Map<String, String> {
        val hints = mutableMapOf<String, String>()

        hints["clickable"] = node.isClickable.toString()
        hints["checkable"] = node.isCheckable.toString()

        // State hints
        hints["checked"] = node.isChecked.toString()
        hints["selected"] = node.isSelected.toString()
        hints["scrollable"] = node.isScrollable.toString()
        if (node.isHeading) hints["heading"] = "true"

        // Layout hints
        node.collectionInfo?.let { collectionInfo ->
            hints["collection"] = "true"
            hints["collection_rows"] = collectionInfo.rowCount.toString()
            hints["collection_columns"] = collectionInfo.columnCount.toString()
        }

        node.collectionItemInfo?.let { itemInfo ->
            hints["collection_item"] = "true"
            hints["item_row"] = itemInfo.rowIndex.toString()
            hints["item_column"] = itemInfo.columnIndex.toString()
        }

        // Range info for sliders/progress bars
        node.rangeInfo?.let { rangeInfo ->
            hints["min"] = rangeInfo.min.toString()
            hints["max"] = rangeInfo.max.toString()
            hints["current"] = rangeInfo.current.toString()
        }

        return hints
    }

    private fun isGridLayout(node: AccessibilityNodeInfo): Boolean {
        val collectionInfo = node.collectionInfo ?: return false
        return collectionInfo.columnCount > 1
    }

    private fun inferContainerRole(node: AccessibilityNodeInfo): UiRole {
        // Try to detect orientation for linear layouts
        val orientation = node.extras?.getInt("android:orientation", -1) ?: -1
        return when (orientation) {
            0 -> UiRole.Row // HORIZONTAL
            1 -> UiRole.Column // VERTICAL
            else -> UiRole.Container
        }
    }

    private fun isLikelyIcon(className: String): Boolean =
        className.contains("ImageView", ignoreCase = true) ||
            className.contains("ImageButton", ignoreCase = true) ||
            className.contains("FloatingActionButton", ignoreCase = true)

    private fun isTabChild(
        className: String,
        parentClassName: String?,
        parentResourceId: String?,
        hasText: Boolean,
    ): Boolean {
        // Check if parent is a TabLayout or BottomNavigationView
        val parentIsTabContainer =
            parentClassName?.let { parent ->
                parent.contains("TabLayout", ignoreCase = true) ||
                    parent.contains("BottomNavigationView", ignoreCase = true)
            } ?: false

        // Check if parent resource ID suggests tabs
        val parentResourceSuggestsTabs =
            parentResourceId?.let { resourceId ->
                resourceId.contains("tab", ignoreCase = true) ||
                    resourceId.contains("navigation", ignoreCase = true) ||
                    resourceId.contains("bottom", ignoreCase = true)
            } ?: false

        return (parentIsTabContainer || parentResourceSuggestsTabs) && hasText
    }

    private fun isLikelyTitle(
        node: AccessibilityNodeInfo,
        parentClassName: String?,
    ): Boolean {
        // Check if node is explicitly marked as heading
        if (node.isHeading) return true

        // Check if parent is Toolbar and this is the main text element
        if (parentClassName?.contains("Toolbar", ignoreCase = true) == true) {
            return true
        }

        // Heuristic: Large text at top of container might be title
        // This would need bounds comparison with parent, but that's complex for now
        return false
    }

    private fun isLikelyLongTextContent(node: AccessibilityNodeInfo): Boolean {
        val text = node.text?.toString() ?: ""
        // Consider text "long" if it contains spaces (likely a sentence) and has reasonable length.
        return text.contains(" ") && text.length > 20
    }

    private fun isLikelyLabel(node: AccessibilityNodeInfo): Boolean {
        // Labels are typically near input fields or have specific accessibility roles
        // This is a heuristic - we could enhance this with more context
        return node.isScreenReaderFocusable && !node.isClickable
    }
}

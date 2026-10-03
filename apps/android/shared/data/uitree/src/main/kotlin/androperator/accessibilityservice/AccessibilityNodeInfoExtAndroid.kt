package androperator.accessibilityservice

import action.log.Log
import action.math.geometry.Rect
import action.math.geometry.toRect
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import androperator.uitree.UiNode
import androperator.uitree.UiNodeId
import androperator.uitree.UiRole
import androperator.uitree.UiRoleInference
import androperator.uitree.UiTree
import androperator.uitree.UiTreeElement
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Traverses the accessibility tree starting from this node and finds all meaningful UI elements.
 * This function improves upon the original by:
 * - Returning structured UxElement objects instead of plain strings
 * - Properly deduplicating elements based on unique properties
 * - Better handling of clickable vs non-clickable elements
 * - More comprehensive element information
 */
fun AccessibilityNodeInfo.findUiTreeElements(): List<UiTreeElement> {
    val allElements = mutableListOf<UiTreeElement>()
    val processedUniqueIds = mutableSetOf<String>()
    val debugInfo = mutableListOf<String>()

    // Traverse the tree and collect all elements
    traverseAndCollectElements(allElements, debugInfo)

    // Log debug info for missing elements investigation
    // TODO: Re-enable for debugging if needed
    // debugInfo.forEach { info ->
    //     action.log.Log.d("[Operator-Debug] $info")
    // }

    // Deduplicate based on unique properties, keeping the most complete element
    val deduplicatedElements = mutableListOf<UiTreeElement>()

    for (element in allElements) {
        val uniqueId = element.uniqueId
        if (!processedUniqueIds.contains(uniqueId)) {
            processedUniqueIds.add(uniqueId)
            deduplicatedElements.add(element)
        }
    }

    // Sort by position (top to bottom, left to right) for consistent ordering
    return deduplicatedElements
        .filter { it.hasContent } // Only return elements with meaningful content
        .sortedWith(compareBy({ it.bounds.top }, { it.bounds.left }))
}

/**
 * Internal helper function to recursively traverse the accessibility tree
 * and collect all UI elements.
 */
private fun AccessibilityNodeInfo.traverseAndCollectElements(
    results: MutableList<UiTreeElement>,
    debugInfo: MutableList<String> = mutableListOf(),
) {
    val node = this

    try {
        // Extract basic properties from the node
        val nodeText = node.text?.toString() ?: ""
        val contentDescription = node.contentDescription?.toString()
        val className = node.className?.toString() ?: "Unknown"
        val resourceId = node.viewIdResourceName
        val isDirectlyClickable = node.isClickable
        val isEnabled = node.isEnabled
        val isVisibleToUser = node.isVisibleToUser

        // Get bounds - use a default if bounds are not available
        val bounds =
            try {
                val androidBounds = android.graphics.Rect()
                node.getBoundsInScreen(androidBounds)
                androidBounds.toRect()
            } catch (e: Exception) {
                Rect.Zero
            }

        // Determine the final text to use for this element
        val finalText =
            when {
                nodeText.isNotBlank() -> nodeText
                contentDescription?.isNotBlank() == true -> contentDescription
                else -> ""
            }

        // Check if this node or any ancestor is clickable (for nested clickable elements)
        val isEffectivelyClickable = isDirectlyClickable || hasClickableAncestor(node)

        // More inclusive filtering - include text elements, clickable elements, and important UI components
        val shouldInclude =
            when {
                // Always include elements with meaningful text
                finalText.isNotBlank() -> true
                // Always include directly clickable elements
                isDirectlyClickable -> true
                // Include elements with content descriptions
                contentDescription?.isNotBlank() == true -> true
                // Include important UI container types that might have nested content
                isImportantContainer(className) -> true
                else -> false
            }

        // Debug logging for elements that might be getting filtered out
        // TODO: Re-enable for debugging room-specific elements if needed
        // if (nodeText.contains("room", ignoreCase = true) ||
        //     contentDescription?.contains("room", ignoreCase = true) == true ||
        //     finalText.contains("room", ignoreCase = true)) {
        //     debugInfo.add("FOUND ROOM TEXT: '$finalText' | nodeText='$nodeText' | contentDesc='$contentDescription' | class=$className | clickable=$isDirectlyClickable | visible=$isVisibleToUser | bounds=$bounds | shouldInclude=$shouldInclude")
        // }

        // Debug ALL text elements to find missing ones
        // TODO: Re-enable for debugging all text elements if needed
        // if (finalText.isNotBlank() && finalText.length > 2) {
        //     debugInfo.add("TEXT ELEMENT: '$finalText' | visible=$isVisibleToUser | bounds=$bounds | shouldInclude=$shouldInclude | size=${bounds.width}x${bounds.height}")
        // }

        if (shouldInclude && bounds != Rect.Zero) {
            val element =
                UiTreeElement(
                    text = finalText,
                    bounds = bounds,
                    className = className,
                    isClickable = isEffectivelyClickable,
                    contentDescription = contentDescription,
                    resourceId = resourceId,
                    isEnabled = isEnabled,
                    isVisible = isVisibleToUser,
                )
            results.add(element)
        } else if (finalText.isNotBlank() || contentDescription?.isNotBlank() == true) {
            // Log why elements with text are being filtered out
            debugInfo.add("FILTERED OUT: '$finalText' | contentDesc='$contentDescription' | shouldInclude=$shouldInclude | bounds=$bounds | visible=$isVisibleToUser | size=${bounds.width}x${bounds.height}")
        }

        // Recursively process children
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { childNode ->
                try {
                    childNode.traverseAndCollectElements(results, debugInfo)
                } finally {
                    // Note: recycle() is deprecated but still necessary for memory management
                    @Suppress("DEPRECATION")
                    childNode.recycle()
                }
            }
        }
    } catch (e: Exception) {
        // Log error but continue processing
        // Note: In a real implementation, you might want to use proper logging
        // Log.w("AccessibilityService", "Error processing node: ${e.message}")
    }
}

/**
 * Checks if this node has a clickable ancestor (parent, grandparent, etc.)
 * This helps identify elements that are part of clickable containers.
 */
private fun hasClickableAncestor(node: AccessibilityNodeInfo): Boolean {
    var current = node.parent
    var depth = 0
    val maxDepth = 3 // Limit search to avoid performance issues

    while (current != null && depth < maxDepth) {
        if (current.isClickable) {
            @Suppress("DEPRECATION")
            current.recycle()
            return true
        }
        val next = current.parent
        @Suppress("DEPRECATION")
        current.recycle()
        current = next
        depth++
    }

    current?.let {
        @Suppress("DEPRECATION")
        it.recycle()
    }

    return false
}

/**
 * Determines if a class represents an important UI container that should be included
 * even if it doesn't have direct text or clickability.
 */
private fun isImportantContainer(className: String): Boolean =
    when {
        className.contains("TabLayout", ignoreCase = true) -> true
        className.contains("NavigationView", ignoreCase = true) -> true
        className.contains("BottomNavigationView", ignoreCase = true) -> true
        className.contains("AppBarLayout", ignoreCase = true) -> true
        className.contains("Toolbar", ignoreCase = true) -> true
        // Add more important container types as needed
        else -> false
    }

/**
 * Builds a hierarchical UiTree from the accessibility tree starting from this node.
 * This creates a structured representation suitable for LLMs and visualization.
 */
fun AccessibilityNodeInfo.buildUiTree(
    windowId: Int,
    screenWidth: Int = 0,
    screenHeight: Int = 0,
    includeContentHash: Boolean = false,
): UiTree {
    val rootNode =
        this.mapToUiNode(
            windowId = windowId,
            indexPath = intArrayOf(),
            siblingIndex = 0,
            screenWidth = screenWidth,
            screenHeight = screenHeight,
            includeContentHash = includeContentHash,
        )
    return UiTree(root = rootNode, windowId = windowId)
}

/**
 * Maps an AccessibilityNodeInfo to a UiNode, recursively processing children.
 * This is the core mapping function that creates the hierarchical structure.
 */
private fun AccessibilityNodeInfo.mapToUiNode(
    windowId: Int,
    indexPath: IntArray,
    siblingIndex: Int,
    screenWidth: Int = 0,
    screenHeight: Int = 0,
    includeContentHash: Boolean = false,
    parentClassName: String? = null,
    parentResourceId: String? = null,
): UiNode {
    try {
        // Extract basic properties
        val nodeText = this.text?.toString() ?: ""
        val contentDescription = this.contentDescription?.toString()
        val className = this.className?.toString() ?: "Unknown"
        val resourceId = this.viewIdResourceName
        val isDirectlyClickable = this.isClickable
        val isEnabled = this.isEnabled
        val isVisibleToUser = this.isVisibleToUser

        // Get bounds
        val bounds =
            try {
                val androidBounds = android.graphics.Rect()
                this.getBoundsInScreen(androidBounds)
                androidBounds.toRect()
            } catch (e: Exception) {
                Rect.Zero
            }

        // Determine label (combine text and content description)
        val label =
            when {
                nodeText.isNotBlank() -> nodeText
                contentDescription?.isNotBlank() == true -> contentDescription
                else -> ""
            }

        // Check for effective clickability (including ancestors)
        val isEffectivelyClickable = isDirectlyClickable || hasClickableAncestor(this)

        // Infer semantic role with parent context
        val role =
            UiRoleInference.inferRole(
                className = className,
                isClickable = isEffectivelyClickable,
                hasText = label.isNotBlank(),
                contentDesc = contentDescription,
                node = this,
                parentClassName = parentClassName,
                parentResourceId = parentResourceId,
            )

        // Extract hints
        val hints = UiRoleInference.extractHints(this)

        // Add disabled hint if node is not enabled
        val hintsWithDisabled =
            if (!isEnabled) {
                hints + ("disabled" to "true")
            } else {
                hints
            }

        // Add redundancy hints for presentation filtering
        val enhancedHints = detectRedundancy(hintsWithDisabled, this, label, bounds, className)

        // Create node ID with optional content hash
        val currentIndexPath = indexPath + siblingIndex
        val nodeId =
            UiNodeId.create(
                windowId = windowId,
                indexPath = currentIndexPath,
                label = label,
                className = className,
                bounds = bounds,
                includeHash = includeContentHash,
            )

        // Recursively process children
        val children = mutableListOf<UiNode>()
        for (i in 0 until this.childCount) {
            this.getChild(i)?.let { childNode ->
                // The captured tree retains this handle for identity checks and dispatch.
                // Recycling clears it on API 32 and earlier; let it be garbage collected
                // with the tree instead of returning a still-referenced handle to the pool.
                children.add(
                    childNode.mapToUiNode(
                        windowId = windowId,
                        indexPath = currentIndexPath,
                        siblingIndex = i,
                        screenWidth = screenWidth,
                        screenHeight = screenHeight,
                        includeContentHash = includeContentHash,
                        parentClassName = className,
                        parentResourceId = resourceId,
                    ),
                )
            }
        }

        return UiNode(
            id = nodeId,
            role = role,
            label = label,
            contentDescription = contentDescription,
            className = className,
            bounds = bounds,
            isClickable = isEffectivelyClickable,
            isEnabled = isEnabled,
            isVisible = isVisibleToUser,
            resourceId = resourceId,
            accessibilityDataSensitive = readAccessibilityDataSensitive(),
            hints = enhancedHints,
            children = children,
            accessibilityNodeInfo = this,
        )
    } catch (e: Exception) {
        // Return a minimal node on error to prevent crashes
        val fallbackId =
            UiNodeId.create(
                windowId = windowId,
                indexPath = indexPath + siblingIndex,
                includeHash = includeContentHash,
            )
        return UiNode(
            id = fallbackId,
            role = UiRole.Unknown,
            label = "Error processing node",
            hints = mapOf("stateUnavailable" to "true"),
            className = "Unknown",
            bounds = Rect.Zero,
            isClickable = false,
            isEnabled = false,
            isVisible = false,
            children = emptyList(),
            accessibilityNodeInfo = this,
        )
    }
}

/**
 * Detects redundant wrapper elements for presentation filtering.
 */
private fun detectRedundancy(
    existingHints: Map<String, String>,
    node: AccessibilityNodeInfo,
    label: String,
    bounds: Rect,
    className: String,
): Map<String, String> {
    val hints = existingHints.toMutableMap()

    // Check if this is a redundant wrapper around a single child
    if (node.childCount == 1) {
        node.getChild(0)?.let { child ->
            try {
                val childText = child.text?.toString() ?: ""
                val childContentDesc = child.contentDescription?.toString() ?: ""

                // If child has same bounds and same/similar text, mark as redundant
                val childBounds =
                    try {
                        val androidBounds = android.graphics.Rect()
                        child.getBoundsInScreen(androidBounds)
                        androidBounds.toRect()
                    } catch (e: Exception) {
                        Rect.Zero
                    }

                val sameBounds = bounds == childBounds
                val sameText =
                    label.isNotBlank() &&
                        (
                            label == childText ||
                                label == childContentDesc ||
                                (childText.isNotBlank() && label.contains(childText)) ||
                                (childContentDesc.isNotBlank() && label.contains(childContentDesc))
                        )

                if (sameBounds && sameText) {
                    hints["redundant"] = "true"
                }
            } finally {
                @Suppress("DEPRECATION")
                child.recycle()
            }
        }
    }

    // Mark synthetic elements in tab containers as potentially redundant
    if (className.contains("Button", ignoreCase = true) &&
        existingHints["redundant"] != "true"
    ) {
        // This could be a synthetic button inside a tab - let the formatter decide
        hints["synthetic_button"] = "potential"
    }

    return hints
}

val AccessibilityNodeInfo.boundsInScreenRect: android.graphics.Rect
    get() {
        val androidBounds = android.graphics.Rect()
        getBoundsInScreen(androidBounds)
        return androidBounds
    }

fun AccessibilityNodeInfo?.recycleSafe() {
    if (this == null) return
    @Suppress("DEPRECATION")
    try {
        recycle()
    } catch (e: Exception) {
        Log.e("AccessibilityNodeInfoExt", "Exception during recycle", e)
    }
}

/**
 * Finds the first clickable ancestor of this node (or itself) by walking up the parent hierarchy.
 * This is used to find a clickable target when the specific node isn't directly clickable.
 *
 * @return The first clickable AccessibilityNodeInfo found, or null if none found within depth limit
 */
fun AccessibilityNodeInfo.firstClickableAncestorOrSelf(): AccessibilityNodeInfo? {
    var current: AccessibilityNodeInfo? = this
    var depth = 0
    while (current != null && depth < 8) {
        if (current.isClickable) return current
        val parent =
            try {
                current.parent
            } catch (_: Exception) {
                null
            }
        // We'll recycle as we climb (except the one we return)
        if (parent == null) break
        // recycle the child we're leaving behind (not the original node; caller will recycle it)
        if (current !== this) current.recycleSafe()
        current = parent
        depth++
    }
    // If we're here, either null or not clickable
    if (current !== this) current?.recycleSafe()
    return null
}

/**
 * Finds the first focusable ancestor of this node (or itself) by walking up the parent hierarchy.
 * Checks both for the ACTION_FOCUS action availability and the isFocusable property.
 * This is used to find a focusable target when the specific node can't receive focus.
 *
 * @return The first focusable AccessibilityNodeInfo found, or null if none found within depth limit
 */
fun AccessibilityNodeInfo.firstFocusableAncestorOrSelf(): AccessibilityNodeInfo? {
    var current: AccessibilityNodeInfo? = this
    var depth = 0
    while (current != null && depth < 8) {
        val hasFocusAction = current.actionList?.any { it.id == AccessibilityNodeInfo.ACTION_FOCUS } ?: false
        if (hasFocusAction || current.isFocusable) return current
        val parent =
            try {
                current.parent
            } catch (_: Exception) {
                null
            }
        // We'll recycle as we climb (except the one we return)
        if (parent == null) break
        // recycle the child we're leaving behind (not the original node; caller will recycle it)
        if (current !== this) current.recycleSafe()
        current = parent
        depth++
    }
    // If we're here, either null or not focusable
    if (current !== this) current?.recycleSafe()
    return null
}

/**
 * Creates a debug string representation of this AccessibilityNodeInfo for logging purposes.
 * Includes key properties like class name, text content, bounds, and clickability status.
 */
fun AccessibilityNodeInfo.debugNode(): String {
    val className = className ?: "?"
    val text = text ?: contentDescription ?: ""
    val bounds = boundsInScreenRect
    return "class=$className text=\"$text\" bounds=$bounds clickable=$isClickable"
}

/**
 * Creates a redacted debug string for sensitive flows such as text entry failures.
 * Omits text-bearing fields so logs do not leak field contents or content descriptions.
 */
fun AccessibilityNodeInfo.debugNodeRedacted(): String {
    val className = className ?: "?"
    val bounds = boundsInScreenRect
    return "class=$className bounds=$bounds clickable=$isClickable enabled=$isEnabled"
}

suspend fun AccessibilityService.dispatchSingleTap(
    x: Float,
    y: Float,
): Boolean {
    val path = Path().apply { moveTo(x, y) }
    val stroke = GestureDescription.StrokeDescription(path, 0L, 120L) // 120ms for better OEM compatibility
    val gesture = GestureDescription.Builder().addStroke(stroke).build()

    val observation = kotlin.coroutines.coroutineContext[androperator.uitree.UiDispatchObservation]
    return suspendCancellableCoroutine { cont ->
        val cb =
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    cont.resume(true)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    cont.resume(false)
                }
            }
        val accepted = dispatchGesture(gesture, cb, null)
        observation?.accepted(accepted)
        if (!accepted) cont.resume(false)
    }
}

suspend fun AccessibilityService.dispatchLongPress(
    x: Float,
    y: Float,
): Boolean {
    val path = Path().apply { moveTo(x, y) }
    val stroke = GestureDescription.StrokeDescription(path, 0L, 650L) // 650ms for long press
    val gesture = GestureDescription.Builder().addStroke(stroke).build()

    val observation = kotlin.coroutines.coroutineContext[androperator.uitree.UiDispatchObservation]
    return suspendCancellableCoroutine { cont ->
        val cb =
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    cont.resume(true)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    cont.resume(false)
                }
            }
        val accepted = dispatchGesture(gesture, cb, null)
        observation?.accepted(accepted)
        if (!accepted) cont.resume(false)
    }
}

suspend fun AccessibilityService.dispatchSwipe(
    startX: Float,
    startY: Float,
    endX: Float,
    endY: Float,
    durationMs: Long,
): Boolean {
    val path =
        Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
    val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs)
    val gesture = GestureDescription.Builder().addStroke(stroke).build()

    val observation = kotlin.coroutines.coroutineContext[androperator.uitree.UiDispatchObservation]
    return suspendCancellableCoroutine { cont ->
        val cb =
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(true)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(false)
                }
            }
        val accepted = dispatchGesture(gesture, cb, null)
        observation?.accepted(accepted)
        if (!accepted && cont.isActive) cont.resume(false)
    }
}

// Track 1 Migration Additions

/**
 * Finds the first editable ancestor of this node (or itself) by walking up the parent hierarchy.
 * Checks for direct editability or support for ACTION_SET_TEXT.
 */
fun AccessibilityNodeInfo.firstEditableAncestorOrSelf(): AccessibilityNodeInfo? {
    var current: AccessibilityNodeInfo? = this
    var depth = 0
    while (current != null && depth < 8) {
        val supportsSetText = current.actionList?.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT } ?: false
        if (current.isEditable || supportsSetText) return current
        val parent =
            try {
                current.parent
            } catch (_: Exception) {
                null
            }
        if (parent == null) break
        if (current !== this) current.recycleSafe()
        current = parent
        depth++
    }
    if (current !== this) current?.recycleSafe()
    return null
}

/**
 * Generates a raw Android hierarchy dump in a `uiautomator dump`-compatible shape.
 * The structure intentionally preserves raw class names and node hierarchy.
 */
fun AccessibilityNodeInfo.toUiAutomatorHierarchyDump(rotation: Int = 0): String {
    val builder = StringBuilder()
    builder.appendLine("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>")
    builder.appendLine("<hierarchy rotation=\"$rotation\">")
    appendUiAutomatorNodeXml(
        node = this,
        indexInParent = 0,
        indent = "  ",
        out = builder,
    )
    builder.appendLine("</hierarchy>")
    return builder.toString()
}

private fun appendUiAutomatorNodeXml(
    node: AccessibilityNodeInfo,
    indexInParent: Int,
    indent: String,
    out: StringBuilder,
) {
    val bounds = android.graphics.Rect()
    node.getBoundsInScreen(bounds)
    val boundsText = "[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]"

    val attrs =
        linkedMapOf(
            "index" to indexInParent.toString(),
            "text" to (node.text?.toString() ?: ""),
            "resource-id" to (node.viewIdResourceName ?: ""),
            "class" to (node.className?.toString() ?: ""),
            "package" to (node.packageName?.toString() ?: ""),
            "content-desc" to (node.contentDescription?.toString() ?: ""),
            "checkable" to node.isCheckable.toString(),
            "checked" to node.isChecked.toString(),
            "clickable" to node.isClickable.toString(),
            "enabled" to node.isEnabled.toString(),
            "visible-to-user" to node.isVisibleToUser.toString(),
            "focusable" to node.isFocusable.toString(),
            "focused" to node.isFocused.toString(),
            "scrollable" to node.isScrollable.toString(),
            "long-clickable" to node.isLongClickable.toString(),
            "password" to node.isPassword.toString(),
            "selected" to node.isSelected.toString(),
            "bounds" to boundsText,
        )

    node.readAccessibilityDataSensitive()?.let { attrs["accessibility-data-sensitive"] = it.toString() }

    out.append(indent).append("<node")
    attrs.forEach { (key, value) ->
        out.append(' ')
        out.append(key)
        out.append("=\"")
        out.append(escapeXmlAttr(value))
        out.append('"')
    }

    if (node.childCount == 0) {
        out.appendLine(" />")
        return
    }

    out.appendLine(">")
    for (i in 0 until node.childCount) {
        node.getChild(i)?.let { child ->
            try {
                appendUiAutomatorNodeXml(
                    node = child,
                    indexInParent = i,
                    indent = "$indent  ",
                    out = out,
                )
            } finally {
                child.recycleSafe()
            }
        }
    }
    out.append(indent).appendLine("</node>")
}

private fun escapeXmlAttr(value: String): String =
    buildString(value.length) {
        value.forEach { ch ->
            when (ch) {
                '&' -> append("&amp;")
                '"' -> append("&quot;")
                '\'' -> append("&apos;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                else -> append(ch)
            }
        }
    }

/** Read only platform evidence; older platforms and failed reads remain unknown. */
fun AccessibilityNodeInfo.readAccessibilityDataSensitive(): Boolean? =
    if (Build.VERSION.SDK_INT >= 34) {
        try {
            isAccessibilityDataSensitive
        } catch (_: Exception) {
            null
        }
    } else {
        null
    }

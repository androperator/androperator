package androperator.app.close

import action.log.Log
import action.system.model.ApplicationId
import action.system.window.WindowFrame
import action.system.window.WindowFrameManager
import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.accessibilityservice.currentAccessibilityService
import androperator.accessibilityservice.openRecentApps
import androperator.accessibilityservice.tryGenericAppCloseGestures
import androperator.uitree.UiNode
import androperator.uitree.UiTreeFilterer
import androperator.uitree.UiTreeInspector
import kotlinx.coroutines.delay
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

class AppCloseManagerAndroid(
    private val uiTreeInspector: UiTreeInspector,
    private val uiTreeFilterer: UiTreeFilterer,
    private val accessibilityServiceManager: AccessibilityServiceManager,
    private val windowFrameManager: WindowFrameManager,
) : AppCloseManager {
    companion object {
        private const val TAG = "[TaskScope-CloseApp]"
    }

    override suspend fun closeFirstAppInRecents(applicationId: ApplicationId) {
        val windowFrame = windowFrameManager.windowFrame.value

        val service =
            accessibilityServiceManager.currentAccessibilityService
                ?: error("Accessibility service not available")
        Log.d("$TAG ✅ Accessibility service available")

        Log.d("$TAG 📱 Step 2: Opening Recents screen")
        service.openRecentApps()
        pause(1.5.seconds) // Longer pause to ensure Recents is fully loaded
        Log.d("$TAG ✅ Recents screen should now be open")

        // 4) Log current UI tree to understand what we're working with
//        Log.d("$TAG 🔍 Step 3: Analyzing current UI tree in Recents")
//        logCurrentUiTreeDetailed()

        // 5) Find and swipe the specific app in Recents
        Log.d("$TAG 🎯 Step 4: Looking for app $applicationId in Recents")
        val gestureSuccess = findAndSwipeAppInRecents(service, applicationId, windowFrame)

        if (!gestureSuccess) {
            Log.w("$TAG ❌ Could not find or swipe app in Recents, falling back to HOME")
            val fallbackSuccess =
                service.performGlobalAction(
                    AccessibilityService.GLOBAL_ACTION_HOME,
                )
            if (!fallbackSuccess) {
                error("Both app-specific swipe and GLOBAL_ACTION_HOME fallback failed")
            }
            Log.d("$TAG ⚠️ Used HOME fallback instead of removing from Recents")
        } else {
            Log.d("$TAG ✅ Successfully swiped app from Recents")
        }

        // 6) Verify app is no longer foreground
        Log.d("$TAG 🔍 Step 5: Verifying app is backgrounded")
        val isBackgrounded = verifyAppBackgrounded(applicationId, uiTreeInspector)
        if (!isBackgrounded) {
            error("App $applicationId is still foreground after close attempt")
        }

        Log.d("$TAG ✅ App $applicationId successfully closed/backgrounded")
    }

    private suspend fun pause(duration: Duration) {
        Log.d("$TAG Pausing for ${duration.inWholeMilliseconds}ms...")
        delay(duration)
        Log.d("$TAG Paused for ${duration.inWholeMilliseconds}ms")
    }

    private suspend fun logCurrentUiTreeDetailed() {
        try {
            Log.d("$TAG 🌳 === UI TREE ANALYSIS START ===")
            val uiTree = uiTreeInspector.getCurrentUiTree()
            if (uiTree == null) {
                Log.w("$TAG ❌ No UI tree available")
                return
            }

            val filtered = uiTreeFilterer.filterOnScreenOnly(uiTree)
            val allNodes = collectAllNodesFromTree(filtered.root)

            Log.d("$TAG 📊 Found ${allNodes.size} UI nodes total")
            Log.d("$TAG 📦 Window ID: ${uiTree.windowId}")

            // Look for package names to understand what's on screen
            val packages =
                allNodes
                    .mapNotNull { node ->
                        try {
                            (node.accessibilityNodeInfo as? AccessibilityNodeInfo)?.packageName?.toString()
                        } catch (e: Exception) {
                            null
                        }
                    }.distinct()

            Log.d("$TAG 📱 Packages found on screen: ${packages.joinToString(", ")}")

            // Look for nodes that might be app cards in Recents
            val clickableNodes = allNodes.filter { it.isClickable }
            Log.d("$TAG 👆 Found ${clickableNodes.size} clickable nodes")

            clickableNodes.take(10).forEachIndexed { index, node ->
                val pkg =
                    try {
                        (node.accessibilityNodeInfo as? AccessibilityNodeInfo)?.packageName?.toString()
                    } catch (e: Exception) {
                        "unknown"
                    }

                Log.d("$TAG 🎯 Clickable[$index]: \"${node.label}\" class=${node.className} pkg=$pkg bounds=${node.bounds} resourceId=${node.resourceId}")
            }

            Log.d("$TAG 🌳 === UI TREE ANALYSIS END ===")
        } catch (e: Exception) {
            Log.e("$TAG ❌ Error analyzing UI tree: ${e.message}")
        }
    }

    private fun collectAllNodesFromTree(root: UiNode): List<UiNode> {
        val nodes = mutableListOf<UiNode>()

        fun traverse(node: UiNode) {
            nodes.add(node)
            node.children.forEach { traverse(it) }
        }
        traverse(root)
        return nodes
    }

    private suspend fun findAndSwipeAppInRecents(
        service: AccessibilityService,
        targetAppId: ApplicationId,
        windowFrame: WindowFrame,
    ): Boolean {
        // Single generic swipe attempt
        val didSwipe =
            service.tryGenericAppCloseGestures(
                windowFrame.deviceWidthPx,
                windowFrame.deviceHeightPx,
            )

        if (!didSwipe) return false

        // Small settle time for One UI animations
        delay(800)

        // Verify once
        val stillInRecents = isAppStillInRecents(targetAppId)
        return !stillInRecents
    }

    private fun findTargetAppNodes(
        allNodes: List<UiNode>,
        targetAppId: ApplicationId,
    ): List<UiNode> =
        allNodes.filter { node ->
            try {
                val pkg = (node.accessibilityNodeInfo as? AccessibilityNodeInfo)?.packageName?.toString()
                val hasTargetPackage = pkg == targetAppId

                // Look for task view containers (these are the app cards in Recents)
                // We rely on package matching and UI structure rather than trying to parse app names
                val isTaskView =
                    node.resourceId?.contains("taskView") == true ||
                        node.resourceId?.contains("recent") == true ||
                        node.className.contains("TaskView") == true

                Log.d("$TAG 🔍 Checking node: label=\"${node.label}\" pkg=$pkg resourceId=${node.resourceId} class=${node.className} hasTargetPackage=$hasTargetPackage isTaskView=$isTaskView")

                // Use package matching and UI heuristics - no unreliable app name extraction
                hasTargetPackage || (isTaskView && node.label.isNotEmpty())
            } catch (e: Exception) {
                Log.w("$TAG ❌ Error checking node: ${e.message}")
                false
            }
        }

    private suspend fun verifyAppBackgrounded(
        appId: ApplicationId,
        uiTreeInspector: UiTreeInspector,
    ): Boolean {
        // Use UiTreeInspector to check current foreground app
        val uiTree = uiTreeInspector.getCurrentUiTree()
        if (uiTree == null) {
            Log.d("$TAG No UI tree available, assuming app is backgrounded")
            return true // No tree usually means not in target app
        }

        // For common source set, we need to handle this differently
        // Since we can't cast to Android types in common, we'll use a simpler approach
        val rootPackage =
            try {
                // Access package name directly from AccessibilityNodeInfo
                val accessibilityNodeInfo = uiTree.root.accessibilityNodeInfo
                (accessibilityNodeInfo as? AccessibilityNodeInfo)?.packageName?.toString()
            } catch (e: Exception) {
                Log.w("$TAG Error accessing package name: ${e.message}")
                null
            }

        val isBackgrounded = rootPackage?.contains(appId) != true

        if (!isBackgrounded) {
            Log.w("$TAG Verification failed: app $appId still foreground (detected: $rootPackage)")
        }

        return isBackgrounded
    }

    private suspend fun isAppStillInRecents(targetAppId: ApplicationId): Boolean {
        return try {
            // Re-inspect the current UI tree to see if our target app is still there
            val uiTree = uiTreeInspector.getCurrentUiTree() ?: return false
            val filtered = uiTreeFilterer.filterOnScreenOnly(uiTree)
            val allNodes = collectAllNodesFromTree(filtered.root)

            // Check if we're even still in the recents view
            val inRecentsView =
                allNodes.any { node ->
                    node.resourceId?.contains("recentContainer") == true ||
                        node.resourceId?.contains("taskView") == true ||
                        node.resourceId?.contains("taskListContainer") == true
                }

            if (!inRecentsView) {
                Log.d("$TAG 🔍 Not in Recents view anymore - app likely closed and returned to home")
                return false
            }

            // Look for the app in the current Recents view
            val targetNodes = findTargetAppNodes(allNodes, targetAppId)
            val found = targetNodes.isNotEmpty()

            Log.d("$TAG 🔍 App still in Recents check: $found (found ${targetNodes.size} matching nodes)")
            if (found) {
                targetNodes.forEachIndexed { index, node ->
                    Log.d("$TAG 🔍   Node[$index]: \"${node.label}\" id=${node.resourceId}")
                }
            }

            found
        } catch (e: Exception) {
            Log.w("$TAG ❌ Error checking if app still in Recents: ${e.message}")
            false // If we can't check, assume the gesture worked and app was closed
        }
    }
}

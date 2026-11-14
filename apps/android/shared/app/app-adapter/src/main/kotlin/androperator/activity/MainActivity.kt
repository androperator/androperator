package androperator.activity

import action.coroutine.collectIn
import action.log.Log
import action.system.window.WindowFrameManagerAndroid
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.coroutineScope
import androperator.app.AppStateManager
import androperator.app.AppViewState
import androperator.app.AppViewModel
import androperator.accessibilityservice.currentAccessibilityService
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.operator.runtime.OperatorCommandService
import androperator.ui.AndroperatorScreen
import org.koin.android.ext.android.inject

class MainActivity : FragmentActivity() {
    companion object {
        private const val Tag = "[MainActivity]"

        private fun log(message: String) = Log.d("$Tag: $message")
    }

    private val appStateManager: AppStateManager by inject()
    private val appViewModel: AppViewModel by inject()
    private val accessibilityServiceManager: AccessibilityServiceManager by inject()
    private val windowFrameManagerAndroid: WindowFrameManagerAndroid by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        log("onCreate() - start")

        windowFrameManagerAndroid.updateWindowFrame()
        configureWindow()
        observeStatusBarHeight()

        tryAndStartOperatorService()

        setContent {
            var viewState by remember { mutableStateOf<AppViewState>(AppViewState.Loading()) }
            // appViewModel in key ensures it is created (and wrapper populated) before we collect appViewState
            LaunchedEffect(appStateManager, appViewModel) {
                appStateManager.appViewState.collect { viewState = it }
            }
            AndroperatorScreen(
                viewState = viewState,
                onDisableAccessibilityService = {
                    accessibilityServiceManager.currentAccessibilityService?.disableSelf()
                },
            )
        }

        log("onCreate() - finish")

        accessibilityServiceManager.isRunning.collectIn(lifecycle.coroutineScope) {
            Log.d("[Operator] Accessibility Service running: $it")
        }
    }

    private fun observeStatusBarHeight() {
        // Critical: services cannot reliably query window bounds/insets.
        // We capture and publish the activity insets/frame here so operator logic running in services
        // can consume accurate window geometry for UI interaction.
        window.decorView.setOnApplyWindowInsetsListener { _, insets ->
            windowFrameManagerAndroid.updateInsetsAndFrame()
            insets
        }
        window.decorView.requestApplyInsets()
    }

    override fun onStart() {
        super.onStart()
        windowFrameManagerAndroid.updateWindowFrame()
    }

    private fun configureWindow() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = true
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
    }

    private val requestPermissionLauncher =
        registerForActivityResult(
            ActivityResultContracts.RequestPermission(),
        ) { isGranted ->
            if (isGranted) {
                startOperatorService()
            }
        }

    private fun tryAndStartOperatorService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED -> {
                    startOperatorService()
                }
                else -> {
                    requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } else {
            startOperatorService()
        }
    }

    private fun startOperatorService() {
        Intent(this, OperatorCommandService::class.java).also { intent ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        }
    }
}

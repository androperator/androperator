package androperator.activity

import action.coroutine.collectIn
import action.log.Log
import action.system.window.WindowFrameManagerAndroid
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.operator.runtime.OperatorCommandService
import androperator.ui.AndroperatorScreen
import action.system.toast.ToastDisplayController
import org.koin.android.ext.android.inject

class MainActivity : FragmentActivity() {
    companion object {
        private const val Tag = "[MainActivity]"

        private fun log(message: String) = Log.d("$Tag: $message")
    }

    private val appStateManager: AppStateManager by inject()
    private val appViewModel: AppViewModel by inject()
    private val accessibilityServiceManager: AccessibilityServiceManager by inject()
    private val toastDisplayController: ToastDisplayController by inject()
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
                onOpenSystemSettings = { openDeveloperOrAboutSettings() },
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

    /**
     * Opens the most relevant settings screen for enabling developer options:
     * - On API 34+: Developer options (or app development settings) if available.
     * - On older APIs: About phone, where the user taps Build number to enable developer mode.
     * Falls back to root Settings if the preferred intent is not available.
     */
    private fun openDeveloperOrAboutSettings() {
        toastDisplayController.showToast(
            "Tap Build number 7 times in About phone, then open Developer options and turn on USB debugging.",
            isLong = true,
        )
        val action = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
                Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
            else -> Settings.ACTION_DEVICE_INFO_SETTINGS
        }
        try {
            startActivity(Intent(action))
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
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

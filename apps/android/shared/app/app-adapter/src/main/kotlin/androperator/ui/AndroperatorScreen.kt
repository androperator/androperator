package androperator.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androperator.app.AppViewState
import androperator.state.operator.AppDoctorState
import androperator.state.operator.OperatorViewState
import androperator.app.adapter.R

/** Crab-colored orange background when system is not ready. */
private val CrabOrange = androidx.compose.ui.graphics.Color(0xFFE07830)

/** Green background when system is ready. */
private val ReadyGreen = androidx.compose.ui.graphics.Color(0xFF2E7D32)

/** Text color on orange/green background for readability. */
private val TextOnBackground = androidx.compose.ui.graphics.Color(0xFF1C1C1C)

@Composable
fun AndroperatorScreen(
    viewState: AppViewState,
    onOpenSystemSettings: () -> Unit,
) {
    val backgroundColor = when (viewState) {
        is AppViewState.Loading -> CrabOrange
        is AppViewState.Data -> {
            val screenState = viewState.screenViewState
            if (screenState is OperatorViewState.Data &&
                screenState.appDoctorState == AppDoctorState.Ready
            ) ReadyGreen else CrabOrange
        }
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        when (viewState) {
            is AppViewState.Loading -> LoadingContent()
            is AppViewState.Data -> {
                val screenState = viewState.screenViewState
                if (screenState is OperatorViewState.Data) {
                    DoctorContent(
                        appDoctorState = screenState.appDoctorState,
                        accessibilityPermissionLabel = screenState.accessibilityPermissionLabel,
                        onOpenSystemSettings = onOpenSystemSettings,
                    )
                } else {
                    LoadingContent()
                }
            }
        }
    }
}

@Composable
private fun LoadingContent() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = TextOnBackground)
    }
}

@Composable
private fun DoctorContent(
    appDoctorState: AppDoctorState,
    accessibilityPermissionLabel: String,
    onOpenSystemSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Top,
    ) {
        Spacer(modifier = Modifier.height(32.dp))
        Text(
            text = "Androperator",
            style = MaterialTheme.typography.headlineLarge,
            color = TextOnBackground,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Image(
            painter = painterResource(R.drawable.androperator_logo),
            contentDescription = "Androperator logo",
            modifier = Modifier
                .size(160.dp)
                .clip(CircleShape),
            contentScale = ContentScale.Fit,
        )
        Spacer(modifier = Modifier.weight(1f))
        when (appDoctorState) {
            AppDoctorState.DeveloperOptionsDisabled -> DeveloperOptionsDisabledContent(onOpenSystemSettings)
            AppDoctorState.UsbDebuggingDisabled -> UsbDebuggingDisabledContent(onOpenSystemSettings)
            AppDoctorState.PermissionsNotGranted -> PermissionsNotGrantedContent(accessibilityPermissionLabel)
            AppDoctorState.Ready -> ReadyContent()
        }
    }
}

@Composable
private fun DeveloperOptionsDisabledContent(onOpenSystemSettings: () -> Unit) {
    Text(
        text = "Android Developer mode must be turned on",
        style = MaterialTheme.typography.titleMedium,
        color = TextOnBackground,
        textAlign = TextAlign.Center,
    )
    Spacer(modifier = Modifier.height(12.dp))
    Text(
        text = "To enable Developer options:\n\n" +
            "1. Open Settings > About phone.\n" +
            "2. Tap \"Build number\" (or \"System version\") 7 times in a row.\n" +
            "3. Go back to Settings and open Developer options.",
        style = MaterialTheme.typography.bodyLarge,
        color = TextOnBackground,
        textAlign = TextAlign.Start,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(modifier = Modifier.height(24.dp))
    Button(onClick = onOpenSystemSettings) {
        Text("Open system settings")
    }
}

@Composable
private fun UsbDebuggingDisabledContent(onOpenSystemSettings: () -> Unit) {
    Text(
        text = "USB debugging must be turned on",
        style = MaterialTheme.typography.titleMedium,
        color = TextOnBackground,
        textAlign = TextAlign.Center,
    )
    Spacer(modifier = Modifier.height(12.dp))
    Text(
        text = "1. Turn on the \"Use developer options\" switch at the top.\n" +
            "2. Scroll down to \"USB debugging\" and turn it on.\n" +
            "3. Grant permissions for this computer when prompted.",
        style = MaterialTheme.typography.bodyLarge,
        color = TextOnBackground,
        textAlign = TextAlign.Start,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(modifier = Modifier.height(24.dp))
    Button(onClick = onOpenSystemSettings) {
        Text("Open Developer options")
    }
}

@Composable
private fun PermissionsNotGrantedContent(accessibilityPermissionLabel: String) {
    Text(
        text = accessibilityPermissionLabel,
        style = MaterialTheme.typography.titleMedium,
        color = TextOnBackground,
        textAlign = TextAlign.Center,
    )
    Spacer(modifier = Modifier.height(12.dp))
    Text(
        text = "Accessibility permissions are not configured. Have your agent run the androperator_grant_android_permissions.sh script.",
        style = MaterialTheme.typography.bodyLarge,
        color = TextOnBackground,
        textAlign = TextAlign.Start,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ReadyContent() {
    Text(
        text = "Ready",
        style = MaterialTheme.typography.headlineSmall,
        color = TextOnBackground,
    )
}

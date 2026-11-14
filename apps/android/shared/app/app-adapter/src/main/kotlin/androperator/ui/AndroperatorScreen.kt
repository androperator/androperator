package androperator.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androperator.app.AppViewState
import androperator.state.operator.OperatorViewState
import androperator.app.adapter.R

private val ScreenBackground = Color(0xFFF7F9F4)
private val TextOnBackground = Color(0xFF19251C)
private val OperatorGreen = Color(0xFF285C32)
private val RunningBackground = Color(0xFFE0EEDB)
private val DisabledBackground = Color(0xFFE9ECE6)

@Composable
fun AndroperatorScreen(
    viewState: AppViewState,
    onDisableAccessibilityService: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ScreenBackground)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        when (viewState) {
            is AppViewState.Loading -> LoadingContent()
            is AppViewState.Data -> {
                val screenState = viewState.screenViewState
                if (screenState is OperatorViewState.Data) {
                    DoctorContent(
                        accessibilityIsRunning = screenState.accessibilityIsRunning,
                        onDisableAccessibilityService = onDisableAccessibilityService,
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
    accessibilityIsRunning: Boolean,
    onDisableAccessibilityService: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
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
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = if (accessibilityIsRunning) "Accessibility service: Running" else "Accessibility service: Disabled",
            style = MaterialTheme.typography.titleMedium,
            color = if (accessibilityIsRunning) OperatorGreen else TextOnBackground,
            modifier = Modifier
                .background(if (accessibilityIsRunning) RunningBackground else DisabledBackground, CircleShape)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = onDisableAccessibilityService,
            enabled = accessibilityIsRunning,
            colors = ButtonDefaults.buttonColors(
                containerColor = OperatorGreen,
                contentColor = Color.White,
                disabledContainerColor = DisabledBackground,
                disabledContentColor = Color(0xFF657060),
            ),
        ) {
            Text("Disable Androperator")
        }
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "While enabled, this accessibility service adds processing overhead and can significantly slow other apps, including animations. Disable it for representative performance measurements. Other installed accessibility services remain enabled.\n\n" +
                "To re-enable, tell your agent to use androperator doctor --fix.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextOnBackground,
        )
    }
}

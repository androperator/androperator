package androperator.conformance

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ConformanceApp()
        }
    }
}

@Composable
fun ConformanceApp() {
    val navController = rememberNavController()
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        NavHost(navController = navController, startDestination = "home") {
            composable("home") {
                HomeScreen(
                    onOpenList = { navController.navigate("list") }
                )
            }
            composable("list") {
                ListScreen(
                    onBack = { navController.popBackStack() },
                    onRowClick = { rowId -> navController.navigate("detail/$rowId") }
                )
            }
            composable(
                "detail/{rowId}",
                arguments = listOf(navArgument("rowId") { type = NavType.StringType })
            ) { backStackEntry ->
                DetailScreen(
                    rowId = backStackEntry.arguments?.getString("rowId") ?: "unknown",
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}

@Composable
fun HomeScreen(onOpenList: () -> Unit) {
    var counter by remember { mutableIntStateOf(0) }
    var enabled by remember { mutableStateOf(true) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Counter: $counter",
            modifier = Modifier.testTag("txt_counter"),
            style = MaterialTheme.typography.headlineMedium
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = { counter++ },
            modifier = Modifier.testTag("btn_increment")
        ) {
            Text("Increment")
        }
        Spacer(modifier = Modifier.height(32.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = if (enabled) "Status: Enabled" else "Status: Disabled", modifier = Modifier.testTag("txt_enabled_state"))
            Switch(
                checked = enabled,
                onCheckedChange = { enabled = it },
                modifier = Modifier.testTag("tgl_enabled")
            )
        }
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onOpenList,
            modifier = Modifier.testTag("btn_open_list")
        ) {
            Text("Open List")
        }
    }
}

@Composable
fun ListScreen(onBack: () -> Unit, onRowClick: (String) -> Unit) {
    val items = (0..199).map { "row_$it" }
    Column(modifier = Modifier.fillMaxSize()) {
        Button(
            onClick = onBack,
            modifier = Modifier.padding(16.dp).testTag("btn_back")
        ) {
            Text("Back")
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .testTag("list_main")
        ) {
            items(items) { item ->
                ListItem(
                    headlineContent = { Text(text = item, modifier = Modifier.testTag(item)) },
                    modifier = Modifier.testTag("item_$item")
                        .fillMaxWidth()
                        .clickable { onRowClick(item) }
                )
                HorizontalDivider()
            }
        }
    }
}

@Composable
fun ListItem(headlineContent: @Composable () -> Unit, modifier: Modifier = Modifier) {
    // Simple custom list item since Material3 ListItem might be more complex than needed for PoC
    Box(modifier = modifier.padding(16.dp)) {
        headlineContent()
    }
}

@Composable
fun DetailScreen(rowId: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Selected: $rowId",
            modifier = Modifier.testTag("txt_selected_row"),
            style = MaterialTheme.typography.headlineMedium
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onBack,
            modifier = Modifier.testTag("btn_back_to_list")
        ) {
            Text("Back to List")
        }
    }
}

package androperator.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

@Composable
fun OpenSourceLicensesScreen(onBack: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxWidth().height(64.dp)) {
            Text(
                text = "Open source licenses",
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center,
                color = Color(0xFF19251C),
                modifier = Modifier.align(Alignment.Center).padding(horizontal = 64.dp),
            )
            IconButton(
                onClick = onBack,
                modifier = Modifier.align(Alignment.CenterStart).padding(start = 16.dp)
                    .size(48.dp).background(Color(0xFFE9ECE6), CircleShape)
                    .semantics { contentDescription = "Navigate up" },
            ) {
                Canvas(modifier = Modifier.size(24.dp)) {
                    val color = Color(0xFF285C32)
                    val start = Offset(size.width * 0.2f, size.height * 0.5f)
                    val stroke = 2.dp.toPx()
                    drawLine(color, start, Offset(size.width * 0.8f, size.height * 0.5f), stroke, StrokeCap.Round)
                    drawLine(color, start, Offset(size.width * 0.5f, size.height * 0.2f), stroke, StrokeCap.Round)
                    drawLine(color, start, Offset(size.width * 0.5f, size.height * 0.8f), stroke, StrokeCap.Round)
                }
            }
        }
        AndroidView(
            modifier = Modifier.weight(1f),
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = false
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.blockNetworkLoads = true
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                            openExternalLink(request.url)

                        @Deprecated("Required for Android versions before API 24")
                        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                            openExternalLink(Uri.parse(url))

                        private fun openExternalLink(uri: Uri): Boolean {
                            // Local license anchors stay in the bundled document. External HTTPS
                            // links open in the browser; the embedded view never loads remote pages.
                            if (uri.scheme == "file" && uri.path == "/android_asset/open_source_licenses.html") return false
                            if (uri.scheme == "https") {
                                try {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                } catch (_: ActivityNotFoundException) {
                                    // The bundled license text remains usable without a browser.
                                }
                            }
                            return true
                        }
                    }
                    loadUrl("file:///android_asset/open_source_licenses.html")
                }
            },
            onRelease = { it.destroy() },
        )
    }
}

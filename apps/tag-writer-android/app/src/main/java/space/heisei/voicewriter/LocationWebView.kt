package space.heisei.voicewriter

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

private const val SITE = "voice.heisei.space"
private const val MAPS = "www.google.com"

@SuppressLint("SetJavaScriptEnabled")
internal fun locationWebView(context: Context, location: MemoryMapLocation, language: String, onPick: ((MemoryPoint) -> Unit)? = null): WebView {
    val maps = Uri.Builder().scheme("https").authority(MAPS).path("/maps/search/")
        .appendQueryParameter("api", "1")
        .appendQueryParameter("query", location.pin?.let { "${it.lat},${it.lng}" } ?: "place")
    location.placeId?.let { maps.appendQueryParameter("query_place_id", it) }
    val fragment = "/android-location?location=${Uri.encode(location.json().toString())}&lang=${Uri.encode(language)}" +
        if (onPick == null) "" else "&pick=1"
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.javaScriptCanOpenWindowsAutomatically = false
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return true
                val uri = request.url
                if (uri.scheme == "https" && uri.port == -1 && uri.userInfo == null) {
                    if (uri.host == MAPS && uri.path == "/maps/search/" && onPick == null) {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, maps.build())) }
                    } else if (uri.host == SITE && uri.path == "/" && onPick != null && request.hasGesture()) {
                        val lat = uri.getQueryParameter("confirmLat")?.toDoubleOrNull()
                        val lng = uri.getQueryParameter("confirmLng")?.toDoubleOrNull()
                        if (lat != null && lng != null) runCatching { MemoryPoint(lat, lng) }.getOrNull()?.let(onPick)
                    }
                }
                return true
            }
        }
        loadUrl("https://$SITE/#$fragment")
    }
}

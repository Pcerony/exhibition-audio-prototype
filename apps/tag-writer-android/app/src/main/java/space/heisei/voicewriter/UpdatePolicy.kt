package space.heisei.voicewriter

import org.json.JSONObject

data class AppUpdate(val name: String, val url: String, val notes: Map<String, String>)

object UpdatePolicy {
    const val FEED = "https://voice.heisei.space/updates/android.json"
    const val PACKAGE = "space.heisei.voicewriter"
    private val releaseUrl = Regex("https://github\\.com/Pcerony/exhibition-audio-prototype/releases/download/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\\.apk")
    fun browserDownload(update: AppUpdate): String {
        require(releaseUrl.matches(update.url))
        return "https://voice.heisei.space/updates/download/${update.url.substringAfterLast('/')}"
    }
    fun hasPendingReports(preferences: Map<String, *>): Boolean = preferences.any { (key, value) ->
        key.endsWith(":reports") && runCatching { org.json.JSONArray(value as String).length() != 0 }.getOrDefault(true)
    }

    fun parse(raw: String, installed: Int, sdk: Int): AppUpdate? {
        val json = JSONObject(raw)
        require(json.getInt("schemaVersion") == 1 && json.getString("packageName") == PACKAGE)
        require(json.getInt("minSdk") in 26..sdk)
        val code = json.getInt("versionCode")
        val name = json.getString("versionName")
        val url = json.getString("url")
        val size = json.getLong("size")
        val hash = json.getString("sha256")
        require(code > 0 && name.length in 1..50 && releaseUrl.matches(url))
        require(size in 1..50_000_000 && hash.matches(Regex("[a-f0-9]{64}")))
        val notes = json.getJSONObject("notes")
        val localized = listOf("ja", "zh", "en").associateWith { notes.getString(it).also { text -> require(text.length in 1..4000) } }
        return if (code > installed) AppUpdate(name, url, localized) else null
    }
}

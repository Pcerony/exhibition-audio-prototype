package space.heisei.voicewriter

import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest

data class AppUpdate(val code: Int, val name: String, val url: String, val size: Long, val hash: String, val notes: Map<String, String>)

object UpdatePolicy {
    const val FEED = "https://voice.heisei.space/updates/android.json"
    const val PACKAGE = "space.heisei.voicewriter"
    fun hasPendingReports(preferences: Map<String, *>): Boolean = preferences.any { (key, value) ->
        key.endsWith(":reports") && runCatching { org.json.JSONArray(value as String).length() != 0 }.getOrDefault(true)
    }
    fun sameApplication(name: String, code: Long, expected: Int, installed: Int, currentSigners: Set<String>, newSigners: Set<String>) =
        name == PACKAGE && code == expected.toLong() && code > installed && currentSigners.isNotEmpty() && currentSigners == newSigners
    fun allowedDownload(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme == "https" && uri.userInfo == null && uri.fragment == null && uri.port in listOf(-1, 443) &&
            uri.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com") &&
            (uri.host != "github.com" || uri.path.startsWith("/Pcerony/exhibition-audio-prototype/releases/download/"))
    }.getOrDefault(false)

    fun parse(raw: String, installed: Int, sdk: Int): AppUpdate? {
        val json = JSONObject(raw)
        require(json.getInt("schemaVersion") == 1 && json.getString("packageName") == PACKAGE)
        require(json.getInt("minSdk") in 26..sdk)
        val code = json.getInt("versionCode")
        val name = json.getString("versionName")
        val url = json.getString("url")
        val size = json.getLong("size")
        val hash = json.getString("sha256")
        require(code > 0 && name.length in 1..50 && allowedDownload(url))
        require(size in 1..50_000_000 && hash.matches(Regex("[a-f0-9]{64}")))
        val notes = json.getJSONObject("notes")
        val localized = listOf("ja", "zh", "en").associateWith { notes.getString(it).also { text -> require(text.length in 1..4000) } }
        return if (code > installed) AppUpdate(code, name, url, size, hash, localized) else null
    }

    fun copyVerified(input: InputStream, file: File, size: Long, hash: String, progress: (Int) -> Unit) {
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var count = 0L
            val started = System.nanoTime()
            file.outputStream().use { output ->
                val buffer = ByteArray(32768)
                while (true) {
                    check(!Thread.currentThread().isInterrupted && System.nanoTime() - started < 180_000_000_000L)
                    val read = input.read(buffer)
                    if (read < 0) break
                    count += read
                    require(count <= size)
                    output.write(buffer, 0, read); digest.update(buffer, 0, read)
                    progress((count * 100 / size).toInt())
                }
            }
            require(count == size && digest.digest().joinToString("") { "%02x".format(it) } == hash)
        } catch (error: Exception) { file.delete(); throw error }
    }
}

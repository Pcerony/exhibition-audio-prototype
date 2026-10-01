package space.heisei.voicewriter

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class Api {
    var token: String = ""
    var userId: String = ""
    fun login(email: String, password: String) {
        val result = request("/auth/v1/token?grant_type=password", JSONObject().put("email", email).put("password", password), false)
        token = result.getString("access_token")
        try { userId = admin(JSONObject().put("action", "session")).getString("userId") } catch (e: Exception) { token = ""; throw e }
    }
    fun admin(body: JSONObject) = request("/functions/v1/admin-api", body, true)
    fun jobs(): List<Job> {
        val jobs = mutableListOf<Job>()
        do {
            val response = admin(JSONObject().put("action", "jobs").put("offset", jobs.size).put("limit", 500))
            val array = response.getJSONArray("jobs")
            val total = response.getInt("total")
            check(array.length() > 0 || jobs.size >= total) { "JOBS_INCOMPLETE" }
            for (i in 0 until array.length()) { val j = array.getJSONObject(i)
                jobs.add(Job(j.getString("id"), j.getString("tagId"), j.getString("label"), j.getString("batch"), j.getString("visitorUrl"), j.getInt("version"), j.getString("status"), j.optString("errorCode").takeUnless { it == "null" || it.isEmpty() })) }
        } while (jobs.size < total)
        return jobs
    }
    fun report(r: Report) {
        val result = admin(reportJson(r).put("action", "provision"))
        check(result.optBoolean("ok")) { "REPORT_REJECTED" }
    }
    private fun request(path: String, body: JSONObject, authenticated: Boolean): JSONObject {
        val base = BuildConfig.SUPABASE_URL.trimEnd('/')
        require(base.startsWith("https://") && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()) { "CONFIG_REQUIRED" }
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"; connection.connectTimeout = 15000; connection.readTimeout = 15000
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            connection.setRequestProperty("Content-Type", "application/json")
            if (authenticated) connection.setRequestProperty("Authorization", "Bearer $token")
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val ok = connection.responseCode in 200..299
            val response = (if (ok) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(response) }.getOrDefault(JSONObject())
            if (!ok) throw IllegalStateException(json.optString("code", "HTTP_${connection.responseCode}"))
            return json
        } finally { connection.disconnect() }
    }
}
fun reportJson(r: Report) = JSONObject().put("jobId", r.jobId).put("version", r.version).put("visitorUrl", r.visitorUrl).put("status", r.status).apply { r.errorCode?.let { put("errorCode", it) } }

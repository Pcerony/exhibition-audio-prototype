package space.heisei.voicewriter

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

class Api(private val store: SecureSession) {
    @Volatile var token = ""; private set
    @Volatile var userId = ""; private set
    var email = ""; private set
    private var refreshToken = ""
    private var expiresAt = 0L
    private val revision = SessionRevision()
    var onRevoked: (() -> Unit)? = null
    @Synchronized fun login(email: String, password: String) {
        val expected = revision.current()
        accept(request("/auth/v1/token?grant_type=password", JSONObject().put("email", email).put("password", password), false), expected)
        try { verify() } catch (e: Exception) { logout(); throw e }
    }
    @Synchronized fun restore(): Boolean {
        val json = store.read()?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return false
        if (json.optString("project") != BuildConfig.SUPABASE_URL) { logout(); return false }
        refreshToken = json.optString("refreshToken")
        if (refreshToken.isBlank()) return false
        refresh(); verify(); return true
    }
    fun logout() {
        revision.invalidate()
        token = ""; userId = ""; email = ""; refreshToken = ""; expiresAt = 0
        store.clear(); onRevoked?.invoke()
    }
    @Synchronized private fun accept(json: JSONObject, expected: Long) = revision.apply(expected) {
        token = json.getString("access_token"); refreshToken = json.getString("refresh_token")
        expiresAt = System.currentTimeMillis() + json.optLong("expires_in", 3600) * 1000
        val user = json.getJSONObject("user"); userId = user.getString("id"); email = user.optString("email")
        store.write(JSONObject().put("refreshToken", refreshToken).put("project", BuildConfig.SUPABASE_URL).toString())
    }
    @Synchronized private fun refresh() {
        val expected = revision.current()
        try { accept(request("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", refreshToken), false), expected) }
        catch (e: ApiException) { if (e.status in listOf(400, 401, 403)) { logout(); throw ApiException("AUTH_REQUIRED", e.status) }; throw e }
    }
    @Synchronized fun verify() {
        val session = admin(JSONObject().put("action", "session"))
        if (session.optString("role") !in listOf("operator", "admin")) { logout(); throw ApiException("OPERATOR_REQUIRED", 403) }
        if (token.isBlank()) throw ApiException("AUTH_REQUIRED", 401)
        userId = session.getString("userId")
    }
    @Synchronized fun admin(body: JSONObject): JSONObject {
        if (refreshToken.isBlank()) throw ApiException("AUTH_REQUIRED", 401)
        if (System.currentTimeMillis() + 60000 >= expiresAt || token.isBlank()) refresh()
        try { return request("/functions/v1/admin-api", body, true) }
        catch (e: ApiException) {
            if (e.status == 401) {
                refresh()
                try { return request("/functions/v1/admin-api", body, true) }
                catch (retry: ApiException) { if (retry.status in listOf(401, 403)) logout(); throw retry }
            }
            if (e.code == "OPERATOR_REQUIRED") logout()
            throw e
        }
    }
    fun categories(): List<Category> {
        val values = admin(JSONObject().put("action", "categories")).getJSONArray("categories")
        return (0 until values.length()).map { val c = values.getJSONObject(it); Category(c.getString("id"), c.getString("name"), c.getString("code")) }
    }
    fun cards(categoryId: String, search: String, sort: String, offset: Int, status: String = "", batchDate: String = ""): Pair<List<Card>, Int> {
        val body = JSONObject().put("action", "list").put("limit", 50).put("offset", offset).put("search", search).put("sort", sort)
        if (categoryId == "uncategorized") body.put("uncategorized", true)
        else if (categoryId.isNotBlank()) body.put("categoryId", categoryId)
        if (status.isNotBlank()) body.put("status", status)
        if (batchDate.isNotBlank()) body.put("batchDate", batchDate)
        val result = admin(body); val rows = result.getJSONArray("tags")
        return (0 until rows.length()).map { parseCard(rows.getJSONObject(it)) } to result.getInt("total")
    }
    fun jobs(): List<Job> {
        val jobs = mutableListOf<Job>()
        do {
            val response = admin(jobsRequest(jobs.size)); val array = response.getJSONArray("jobs"); val total = response.getInt("total")
            check(array.length() > 0 || jobs.size >= total) { "JOBS_INCOMPLETE" }
            for (i in 0 until array.length()) jobs.add(parseJob(array.getJSONObject(i)))
        } while (jobs.size < total)
        return jobs
    }
    fun lease(jobId: String?, deviceId: String): Lease? {
        val response = admin(leaseRequest(jobId, deviceId)); val job = response.optJSONObject("job") ?: return null
        return Lease(parseJob(job), response.getString("leaseToken"), Instant.parse(response.getString("expiresAt")).toEpochMilli())
    }
    fun release(lease: Lease) { admin(JSONObject().put("action", "releaseJob").put("jobId", lease.job.id).put("leaseToken", lease.token)) }
    fun inspect(url: String): Card? {
        val token = NfcInspection.token(url) ?: return null
        val job = jobs().find { it.visitorUrl == url }
        val tag = try { request("/functions/v1/public-tag?token=$token", null, false) }
        catch (e: ApiException) { if (e.status == 404) return null else throw e }
        return parseCard(tag).copy(version = job?.tagVersion ?: 0, job = job)
    }
    fun report(r: Report) {
        check(Provisioning.canSync(r)) { "CLIENT_UPGRADE_REQUIRED" }
        check(admin(reportJson(r).put("action", "provision")).optBoolean("ok")) { "REPORT_REJECTED" }
    }
    private fun request(path: String, body: JSONObject?, authenticated: Boolean): JSONObject {
        val base = BuildConfig.SUPABASE_URL.trimEnd('/')
        require(base.startsWith("https://") && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()) { "CONFIG_REQUIRED" }
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.requestMethod = if (body == null) "GET" else "POST"; connection.connectTimeout = 15000; connection.readTimeout = 15000
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY); connection.setRequestProperty("Content-Type", "application/json")
            if (authenticated) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) { connection.doOutput = true; connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) } }
            val status = connection.responseCode; val ok = status in 200..299
            val response = (if (ok) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(response) }.getOrDefault(JSONObject())
            if (!ok) throw ApiException(json.optString("code", "HTTP_$status"), status)
            return json
        } finally { connection.disconnect() }
    }
}
class ApiException(val code: String, val status: Int) : Exception(code)
fun JSONObject.nullableString(key: String) = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }
fun jobsRequest(offset: Int) = JSONObject().put("action", "jobs").put("offset", offset).put("limit", 500).put("protocolVersion", 3)
fun leaseRequest(jobId: String?, deviceId: String) = JSONObject().put("action", if (jobId == null) "nextJob" else "leaseJob").put("deviceId", deviceId).put("protocolVersion", 3).apply { jobId?.let { put("jobId", it) } }
fun parseCard(c: JSONObject): Card {
    val r = c.optJSONObject("recording")
    return Card(c.getString("id"), c.getString("label"), c.nullableString("categoryId"), c.nullableString("batch").orEmpty(), c.optInt("version"), c.optString("status", "unbound"), r?.nullableString("id"), r?.nullableString("nickname").orEmpty(), r?.nullableString("createdAt"), c.optJSONObject("provisioning")?.let(::parseJob), c.nullableString("inventoryLabel").orEmpty(), c.nullableString("categoryCode"), c.nullableString("batchDate"), c.nullableString("serialNumber"))
}
fun parseReport(r: JSONObject) = Report(r.getString("jobId"), r.getInt("version"), r.getString("visitorUrl"), r.getString("status"), r.nullableString("errorCode"), r.optString("leaseToken"), r.optInt("protocolVersion", 2))
fun parseJob(j: JSONObject) = Job(j.getString("id"), j.getString("tagId"), j.getString("label"), j.nullableString("batch").orEmpty(), j.getString("visitorUrl"), j.getInt("version"), j.getString("status"), j.nullableString("errorCode"), j.nullableString("categoryId"), j.optString("recordingStatus", "unbound"), j.optInt("tagVersion"), j.nullableString("writtenAt"), j.nullableString("inventoryLabel").orEmpty(), j.nullableString("categoryCode"), j.nullableString("batchDate"), j.nullableString("serialNumber"))
fun reportJson(r: Report) = JSONObject().put("jobId", r.jobId).put("version", r.version).put("visitorUrl", r.visitorUrl).put("status", r.status).put("protocolVersion", r.protocolVersion).put("leaseToken", r.leaseToken).apply { r.errorCode?.let { put("errorCode", it) } }

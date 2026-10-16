package space.heisei.voicewriter

import org.json.JSONObject
import java.util.UUID

/** One durable record atomically replaces the request key with the accepted job. */
class PreparationMemory(private val read: () -> String?, private val write: (String) -> Boolean) {
    private fun record() = read()?.let(::JSONObject) ?: JSONObject()
    fun jobId(): String? = record().nullableString("jobId")
    fun requestKey(): String {
        val record = record()
        record.nullableString("requestKey")?.let { return it }
        check(record.nullableString("jobId") == null) { "JOB_CONFLICT" }
        val key = UUID.randomUUID().toString()
        check(write(JSONObject().put("requestKey", key).toString())) { "LOCAL_SAVE_FAILED" }
        return key
    }
    fun accepted(jobId: String) { check(write(JSONObject().put("jobId", jobId).toString())) { "LOCAL_SAVE_FAILED" } }
    fun accepted(job: Job) {
        check(write(JSONObject().put("jobId", job.id).put("version", job.version).put("tagVersion", job.tagVersion).put("visitorUrl", job.visitorUrl).toString())) { "LOCAL_SAVE_FAILED" }
    }
    fun matches(job: Job): Boolean {
        val record = record()
        return record.optString("jobId") == job.id && record.optInt("version", -1) == job.version &&
            record.optInt("tagVersion", -1) == job.tagVersion && record.optString("visitorUrl") == job.visitorUrl
    }
    fun physicalUncertain() = record().optBoolean("physicalAttempt")
    fun beginPhysical(jobId: String) {
        val record = record()
        check(record.optString("jobId") == jobId) { "JOB_CONFLICT" }
        check(write(record.put("physicalAttempt", true).toString())) { "LOCAL_SAVE_FAILED" }
    }
    fun failedPhysical(jobId: String) {
        val record = record()
        if (record.optString("jobId") == jobId) check(write(record.put("physicalAttempt", false).toString())) { "LOCAL_SAVE_FAILED" }
    }
    fun completed(jobId: String) { if (jobId() == jobId) check(write("{}")) { "LOCAL_SAVE_FAILED" } }
    fun resetReviewed() { check(write("{}")) { "LOCAL_SAVE_FAILED" } }
}

class SuccessGate {
    private var since: Long? = null
    private var absent = false
    fun success(now: Long) { since = now; absent = false }
    fun removed() { absent = true }
    fun advance(now: Long) = since?.let { absent && now - it >= 1000 } ?: false
    fun cancel() { since = null; absent = false }
}

enum class WriteFeedback(val title: String, val body: String, val icon: String) {
    PREPARING("preparing", "preparingBody", "…"),
    READY("ready", "readyBody", "◎"),
    WRITING("writingTitle", "writing", "↻"),
    SUCCESS("writeSuccess", "remove", "✓"),
    ERROR("failed", "failureBody", "!"),
    PENDING("pendingCloud", "pendingCloudBody", "↑")
}

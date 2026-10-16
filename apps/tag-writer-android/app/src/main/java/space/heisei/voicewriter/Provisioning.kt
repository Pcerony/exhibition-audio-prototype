package space.heisei.voicewriter

data class Job(val id: String, val tagId: String, val label: String, val batch: String, val visitorUrl: String, val version: Int, val status: String, val errorCode: String?, val categoryId: String = "", val recordingStatus: String = "unbound", val tagVersion: Int = 0, val writtenAt: String? = null)
data class Report(val jobId: String, val version: Int, val visitorUrl: String, val status: String, val errorCode: String?, val leaseToken: String = "")
data class Category(val id: String, val name: String, val code: String) { override fun toString() = "$code · $name" }
data class Card(val id: String, val label: String, val categoryId: String, val categoryName: String, val version: Int, val status: String, val recordingId: String?, val nickname: String, val recordedAt: String?, val job: Job?)
data class Lease(val job: Job, val token: String, val expiresAt: Long)
object Provisioning {
    fun validUrl(url: String) = Regex("https://voice\\.heisei\\.space/#/t/[A-Za-z0-9_-]{22,}").matches(url)
    fun readback(job: Job, uris: List<String>): Report = if (validUrl(job.visitorUrl) && uris == listOf(job.visitorUrl))
        Report(job.id, job.version, job.visitorUrl, "verified", null) else failure(job, "READBACK_MISMATCH")
    fun failure(job: Job, code: String) = Report(job.id, job.version, job.visitorUrl, "failed", code)
    fun matches(report: Report, job: Job) = report.jobId == job.id && report.version == job.version && report.visitorUrl == job.visitorUrl
    fun superseded(report: Report, job: Job) = matches(report, job) && report.status == "failed" && job.status == "verified"
    fun canArm(resumed: Boolean, startEpoch: Int, currentEpoch: Int) = resumed && startEpoch == currentEpoch
}

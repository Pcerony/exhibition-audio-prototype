package space.heisei.voicewriter

data class Job(val id: String, val tagId: String, val label: String, val batch: String, val visitorUrl: String, val version: Int, val status: String, val errorCode: String?)
data class Report(val jobId: String, val version: Int, val visitorUrl: String, val status: String, val errorCode: String?)
object Provisioning {
    fun validUrl(url: String) = Regex("https://voice\\.heisei\\.space/#/t/[A-Za-z0-9_-]{22,}").matches(url)
    fun readback(job: Job, uris: List<String>): Report = if (validUrl(job.visitorUrl) && uris == listOf(job.visitorUrl))
        Report(job.id, job.version, job.visitorUrl, "verified", null) else failure(job, "READBACK_MISMATCH")
    fun failure(job: Job, code: String) = Report(job.id, job.version, job.visitorUrl, "failed", code)
    fun matches(report: Report, job: Job) = report.jobId == job.id && report.version == job.version && report.visitorUrl == job.visitorUrl
    fun superseded(report: Report, job: Job) = matches(report, job) && report.status == "failed" && job.status == "verified"
    fun canArm(resumed: Boolean, startEpoch: Int, currentEpoch: Int) = resumed && startEpoch == currentEpoch
}

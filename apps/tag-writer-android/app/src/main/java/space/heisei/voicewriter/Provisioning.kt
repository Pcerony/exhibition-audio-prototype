package space.heisei.voicewriter

data class Job(val id: String, val tagId: String, val label: String, val batch: String, val visitorUrl: String, val version: Int, val status: String, val errorCode: String?, val categoryId: String? = null, val recordingStatus: String = "unbound", val tagVersion: Int = 0, val writtenAt: String? = null, val inventoryLabel: String = "", val categoryCode: String? = null, val batchDate: String? = null, val serialNumber: String? = null, val jobKind: String = "nfc") {
    val displayLabel get() = if (recordingStatus == "unbound") inventoryLabel.ifBlank { label } else serialNumber ?: label
}
data class Report(val jobId: String, val version: Int, val visitorUrl: String, val status: String, val errorCode: String?, val leaseToken: String = "", val protocolVersion: Int = 3, val jobKind: String = "nfc")
data class Category(val id: String, val name: String, val code: String) { override fun toString() = "$code · $name" }
data class Card(val id: String, val label: String, val categoryId: String?, val categoryName: String, val version: Int, val status: String, val recordingId: String?, val nickname: String, val recordedAt: String?, val job: Job?, val inventoryLabel: String = "", val categoryCode: String? = null, val batchDate: String? = null, val serialNumber: String? = null, val entryChannel: String = "nfc") {
    val displayLabel get() = if (recordingId == null) inventoryLabel.ifBlank { label } else serialNumber ?: label
}
data class Lease(val job: Job, val token: String, val expiresAt: Long)
object Provisioning {
    fun canSync(report: Report) = report.protocolVersion == 3 && report.jobKind in listOf("nfc", "qr")
    fun canMove(cards: List<Card>) = cards.isNotEmpty() && cards.all { it.recordingId != null }
    fun validUrl(url: String) = Regex("https://voice\\.heisei\\.space/#/t/[A-Za-z0-9_-]{22,}").matches(url)
    fun readback(job: Job, uris: List<String>): Report = if (validUrl(job.visitorUrl) && uris == listOf(job.visitorUrl))
        Report(job.id, job.version, job.visitorUrl, "verified", null, jobKind=job.jobKind) else failure(job, "READBACK_MISMATCH")
    fun failure(job: Job, code: String) = Report(job.id, job.version, job.visitorUrl, "failed", code, jobKind=job.jobKind)
    fun matches(report: Report, job: Job) = report.jobKind == job.jobKind && report.jobId == job.id && report.version == job.version && report.visitorUrl == job.visitorUrl
    fun superseded(report: Report, job: Job) = matches(report, job) && report.status == "failed" && job.status == "verified"
    fun canDiscardSuperseded(report: Report, job: Job) = report.jobKind == "qr" && superseded(report, job)
    fun canArm(resumed: Boolean, startEpoch: Int, currentEpoch: Int) = resumed && startEpoch == currentEpoch
}

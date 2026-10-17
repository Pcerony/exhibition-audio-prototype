package space.heisei.voicewriter

import java.security.MessageDigest

enum class SingleOperation { CLEAR, NEW, RESTORE }
data class SingleMutation(val chip: String, val fingerprint: String, val operation: SingleOperation) {
    fun matches(identity: String, content: String) = chip.isNotBlank() && fingerprint.isNotBlank() && chip == identity && fingerprint == content
}
object SingleCardPolicy {
    fun retryIsSafe(errorCode: String?) = errorCode in setOf("CHIP_CHANGED", "FOREIGN_TAG", "READ_ONLY", "CAPACITY", "INVALID_URL", "UNSUPPORTED", "JOB_CONFLICT")
    fun reviewMatches(reviewed: InspectedCard, fresh: Card?): Boolean {
        val old = reviewed.card
        if (old == null) return reviewed.state == "readMissing" && fresh == null
        return fresh != null && fresh.id == old.id && fresh.status == old.status && fresh.recordingId == old.recordingId && fresh.version == old.version
    }
    fun fingerprint(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    fun canChange(tag: InspectedTag?, cards: List<InspectedCard>): Boolean {
        if (tag == null || tag.kind !in listOf("empty", "data", "unformatted") || tag.writable != true || tag.truncated || tag.fingerprint.isBlank()) return false
        if (tag.records.any { it.value.endsWith("\u2026") }) return false
        return NfcInspection.urls(tag.records).all { url -> cards.any { it.url == url && it.state in listOf("readExhibition", "readMissing") } }
    }
}

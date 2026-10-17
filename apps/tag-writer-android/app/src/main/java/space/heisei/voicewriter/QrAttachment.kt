package space.heisei.voicewriter

object QrAttachmentPolicy {
    fun canPrepare(card: Card) = card.entryChannel == "qr" && card.status == "bound" && card.recordingId != null &&
        card.job?.status != "verified" && (card.job == null || (card.job.jobKind == "qr" && card.job.tagVersion == card.version))
    fun accepts(tag: InspectedTag, url: String): Boolean {
        if (!Provisioning.validUrl(url) || tag.writable != true || tag.truncated) return false
        return tag.kind in listOf("empty", "unformatted") ||
            (tag.kind == "data" && tag.records.size == 1 && tag.records.single().kind == "uri" && tag.records.single().value == url)
    }
    fun chipHash(id: ByteArray): String { require(id.isNotEmpty()) { "CHIP_CHANGED" }; return SingleCardPolicy.fingerprint(id) }
}

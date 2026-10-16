package space.heisei.voicewriter

data class InspectedRecord(val kind: String, val value: String, val bytes: Int)
data class InspectedTag(val kind: String, val records: List<InspectedRecord> = emptyList(), val writable: Boolean? = null, val truncated: Boolean = false)
data class InspectedCard(val url: String, val state: String, val card: Card? = null)

object NfcInspection {
    fun current(resumed: Boolean, readPage: Boolean, expectedEpoch: Int, epoch: Int, owner: String, currentOwner: String) =
        resumed && readPage && expectedEpoch == epoch && owner.isNotBlank() && owner == currentOwner
    private val visitorUrl = Regex("https://voice\\.heisei\\.space/#/t/([a-f0-9]{48})")
    fun token(url: String): String? = visitorUrl.matchEntire(url)?.groupValues?.get(1)
    fun isEmpty(records: List<InspectedRecord>) = records.all { it.kind == "empty" }
    fun urls(records: List<InspectedRecord>) = records.filter { it.kind == "uri" && token(it.value) != null }.map { it.value }.distinct()
    fun display(value: String) = if (value.length > 2048) value.take(2048) + "\u2026" else value
    fun text(payload: ByteArray): String? {
        if (payload.isEmpty()) return null
        val status = payload[0].toInt() and 0xff
        val start = 1 + (status and 0x3f)
        if (status and 0x40 != 0 || start > payload.size) return null
        val charset = if (status and 0x80 != 0) Charsets.UTF_16 else Charsets.UTF_8
        val length = (payload.size - start).coerceAtMost(4096)
        return display(String(payload, start, length, charset)) + if (payload.size - start > length) "\u2026" else ""
    }
}

package space.heisei.voicewriter

import android.nfc.NdefRecord
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable

object NfcReader {
    fun read(tag: Tag): InspectedTag {
        val ndef = Ndef.get(tag) ?: return InspectedTag(if (NdefFormatable.get(tag) != null) "unformatted" else "unsupported")
        try {
            ndef.connect()
            val records = ndef.ndefMessage?.records.orEmpty()
            val decoded = records.take(32).map { record ->
                val payload = record.payload
                when {
                    record.tnf == NdefRecord.TNF_EMPTY -> InspectedRecord("empty", "", 0)
                    record.toUri() != null -> InspectedRecord("uri", NfcInspection.display(record.toUri().toString()), payload.size)
                    record.tnf == NdefRecord.TNF_WELL_KNOWN && record.type.contentEquals(NdefRecord.RTD_TEXT) -> {
                        val text = NfcInspection.text(payload)
                        InspectedRecord(if (text == null) "other" else "text", text.orEmpty(), payload.size)
                    }
                    else -> InspectedRecord("other", "TNF ${record.tnf}", payload.size)
                }
            }
            return InspectedTag(if (NfcInspection.isEmpty(decoded) && records.size <= 32) "empty" else "data", decoded, ndef.isWritable, records.size > 32)
        } finally { runCatching { ndef.close() } }
    }
}

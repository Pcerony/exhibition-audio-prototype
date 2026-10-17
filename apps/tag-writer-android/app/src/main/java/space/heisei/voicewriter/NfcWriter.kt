package space.heisei.voicewriter

import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable

class WriterException(val code: String) : Exception(code)

object NfcWriter {
    fun writeAndRead(tag: Tag, job: Job, overwriteConfirmed: Boolean = false, expected: SingleMutation? = null, stillAllowed: () -> Boolean): Report {
        if (!Provisioning.validUrl(job.visitorUrl)) throw WriterException("INVALID_URL")
        val message = NdefMessage(arrayOf(NdefRecord.createUri(job.visitorUrl)))
        val ndef = Ndef.get(tag)
        if (ndef == null) {
            if (expected != null && !expected.matches(identity(tag), "unformatted")) throw WriterException("CHIP_CHANGED")
            val format = NdefFormatable.get(tag) ?: throw WriterException("UNSUPPORTED")
            try {
                format.connect()
                if (!stillAllowed()) throw WriterException("JOB_CONFLICT")
                format.format(message)
            } finally { format.close() }
            throw WriterException("FORMATTED_RETRY")
        }
        try {
            ndef.connect()
            if (!ndef.isWritable) throw WriterException("READ_ONLY")
            if (ndef.maxSize < message.toByteArray().size) throw WriterException("CAPACITY")
            val current = ndef.ndefMessage
            if (expected != null && !expected.matches(identity(tag), SingleCardPolicy.fingerprint(current?.toByteArray() ?: byteArrayOf()))) throw WriterException("CHIP_CHANGED")
            val existing = current?.records?.map { it.toUri()?.toString().orEmpty() }.orEmpty()
            if (!WriterSafety.mayWrite(existing, job.visitorUrl, overwriteConfirmed)) throw WriterException("FOREIGN_TAG")
            if (!stillAllowed()) throw WriterException("JOB_CONFLICT")
            ndef.writeNdefMessage(message)
        } finally { ndef.close() }
        // Reconnect and read the physical NDEF message, not discovery's cached data.
        try {
            ndef.connect()
            val fresh = ndef.ndefMessage ?: throw WriterException("READBACK_MISMATCH")
            return Provisioning.readback(job, fresh.records.map { it.toUri()?.toString().orEmpty() })
        } finally { ndef.close() }
    }
    fun clearAndRead(tag: Tag, expected: SingleMutation, stillAllowed: () -> Boolean) {
        val ndef = Ndef.get(tag) ?: throw WriterException("UNSUPPORTED")
        try {
            ndef.connect()
            if (!ndef.isWritable) throw WriterException("READ_ONLY")
            val current = ndef.ndefMessage
            if (!expected.matches(identity(tag), SingleCardPolicy.fingerprint(current?.toByteArray() ?: byteArrayOf()))) throw WriterException("CHIP_CHANGED")
            if (!stillAllowed()) throw WriterException("JOB_CONFLICT")
            val empty = NdefMessage(arrayOf(NdefRecord(NdefRecord.TNF_EMPTY, byteArrayOf(), byteArrayOf(), byteArrayOf())))
            if (ndef.maxSize < empty.toByteArray().size) throw WriterException("CAPACITY")
            ndef.writeNdefMessage(empty)
        } finally { runCatching { ndef.close() } }
        try {
            ndef.connect()
            val fresh = ndef.ndefMessage ?: throw WriterException("READBACK_MISMATCH")
            if (fresh.records.any { it.tnf != NdefRecord.TNF_EMPTY }) throw WriterException("READBACK_MISMATCH")
        } finally { runCatching { ndef.close() } }
    }
    private fun identity(tag: Tag) = tag.id.joinToString("") { "%02x".format(it) }
}

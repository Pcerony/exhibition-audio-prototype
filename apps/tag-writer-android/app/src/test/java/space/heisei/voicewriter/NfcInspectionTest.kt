package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class NfcInspectionTest {
    private val url = "https://voice.heisei.space/#/t/" + "a".repeat(48)
    @Test fun onlyCompleteCanonicalVisitorLinksAreCandidates() {
        assertEquals("a".repeat(48), NfcInspection.token(url))
        listOf(url.replace("https", "http"), url.replace("voice.heisei.space", "voice.heisei.space.evil.test"),
            url.replace("voice.heisei.space", "evil@voice.heisei.space"), url.replace("space/", "space:443/"),
            url + "?extra=1", url + "/", url.dropLast(1), "https://voice.heisei.space/#/admin").forEach {
            assertNull(it, NfcInspection.token(it))
        }
    }
    @Test fun emptyAndBinaryRecordsAreNotConfused() {
        assertTrue(NfcInspection.isEmpty(emptyList()))
        assertTrue(NfcInspection.isEmpty(listOf(InspectedRecord("empty", "", 0))))
        assertFalse(NfcInspection.isEmpty(listOf(InspectedRecord("other", "", 18))))
        assertFalse(NfcInspection.isEmpty(listOf(InspectedRecord("text", "", 0))))
    }
    @Test fun onlyUriRecordsBecomeCandidatesAndDuplicatesAreRemoved() {
        assertEquals(listOf(url), NfcInspection.urls(listOf(InspectedRecord("uri", url, 60), InspectedRecord("uri", url, 60), InspectedRecord("text", url, 60))))
        assertTrue(NfcInspection.urls(listOf(InspectedRecord("uri", "https://example.invalid/", 20))).isEmpty())
    }
    @Test fun displayIsBoundedWithoutTurningClippedContentIntoACard() {
        val malicious = url + "x".repeat(5000)
        assertTrue(NfcInspection.display(malicious).length <= 2049)
        assertNull(NfcInspection.token(malicious))
        assertEquals("hello", NfcInspection.display("hello"))
    }
    @Test fun everyReaderLabelHasThreeTranslations() {
        val keys = listOf("readNfc", "readReady", "readAgain", "readContents", "readEmpty", "readUnformatted", "readExternal", "readFailed", "readCloud", "readUnknown", "readMissing", "readExhibition", "readTruncated", "readUri", "readText", "readOther", "readEmptyRecord", "readReadOnly", "readWritable", "readRetry")
        for (language in listOf("ja", "zh", "en")) for (key in keys) {
            val copy = Copy(language)
            assertTrue(key, key in copy.availableKeys)
            assertNotEquals(key, copy["error"], copy[key])
        }
    }
    @Test fun textRecordsDecodeUtf8Utf16AndRejectMalformedHeaders() {
        assertEquals("福岡", NfcInspection.text(byteArrayOf(2, 106, 97) + "福岡".toByteArray(Charsets.UTF_8)))
        assertEquals("Fukuoka", NfcInspection.text(byteArrayOf(0x82.toByte(), 101, 110) + "Fukuoka".toByteArray(Charsets.UTF_16)))
        assertNull(NfcInspection.text(byteArrayOf()))
        assertNull(NfcInspection.text(byteArrayOf(63, 101)))
        assertNull(NfcInspection.text(byteArrayOf(64)))
        assertTrue(NfcInspection.text(byteArrayOf(0) + ByteArray(8000) { 65 })!!.length <= 2050)
    }
    @Test fun backgroundOrDifferentPageOrAccountCannotPublishReadResults() {
        assertTrue(NfcInspection.current(true, true, 2, 2, "staff", "staff"))
        assertFalse(NfcInspection.current(false, true, 2, 2, "staff", "staff"))
        assertFalse(NfcInspection.current(true, false, 2, 2, "staff", "staff"))
        assertFalse(NfcInspection.current(true, true, 2, 3, "staff", "staff"))
        assertFalse(NfcInspection.current(true, true, 2, 2, "staff", "other"))
        assertFalse(NfcInspection.current(true, true, 2, 2, "", ""))
    }
}

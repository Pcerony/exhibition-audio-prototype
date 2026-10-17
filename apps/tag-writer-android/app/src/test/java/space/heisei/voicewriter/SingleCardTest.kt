package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class SingleCardTest {
    private val url = "https://voice.heisei.space/#/t/" + "a".repeat(48)
    private fun snapshot() = InspectedTag("data", listOf(InspectedRecord("uri", url, 70)), true, false, "hash")
    @Test fun approvalRequiresSamePhysicalCardAndUnchangedCompleteContent() {
        val mutation = SingleMutation("chip-a", "hash", SingleOperation.CLEAR)
        assertTrue(mutation.matches("chip-a", "hash"))
        assertFalse(mutation.matches("chip-b", "hash"))
        assertFalse(mutation.matches("chip-a", "changed"))
        assertFalse(SingleMutation("", "hash", SingleOperation.NEW).matches("", "hash"))
    }
    @Test fun allExhibitionLinksMustBeResolvedBeforeAnyMutation() {
        assertFalse(SingleCardPolicy.canChange(snapshot(), emptyList()))
        assertFalse(SingleCardPolicy.canChange(snapshot(), listOf(InspectedCard(url, "readCloud"))))
        assertFalse(SingleCardPolicy.canChange(snapshot(), listOf(InspectedCard(url, "readUnknown"))))
        assertTrue(SingleCardPolicy.canChange(snapshot(), listOf(InspectedCard(url, "readMissing"))))
        assertTrue(SingleCardPolicy.canChange(snapshot(), listOf(InspectedCard(url, "readExhibition"))))
    }
    @Test fun writableEmptyAndExternalCardsAreActionableButReadFailureIsNot() {
        assertTrue(SingleCardPolicy.canChange(InspectedTag("empty", writable = true, fingerprint = "hash"), emptyList()))
        assertTrue(SingleCardPolicy.canChange(InspectedTag("data", listOf(InspectedRecord("text", "outside", 7)), true, fingerprint = "hash"), emptyList()))
        assertFalse(SingleCardPolicy.canChange(snapshot().copy(writable = false), listOf(InspectedCard(url, "readExhibition"))))
        assertFalse(SingleCardPolicy.canChange(snapshot().copy(truncated = true), listOf(InspectedCard(url, "readExhibition"))))
        assertFalse(SingleCardPolicy.canChange(InspectedTag("failed"), emptyList()))
        assertFalse(SingleCardPolicy.canChange(snapshot().copy(fingerprint = ""), listOf(InspectedCard(url, "readExhibition"))))
    }
    @Test fun fingerprintsIncludeAllBytesRatherThanOnlyDisplayedContent() {
        assertEquals(SingleCardPolicy.fingerprint(byteArrayOf(1,2)), SingleCardPolicy.fingerprint(byteArrayOf(1,2)))
        assertNotEquals(SingleCardPolicy.fingerprint(byteArrayOf(1,2)), SingleCardPolicy.fingerprint(byteArrayOf(1,3)))
    }
    @Test fun multipleExhibitionLinksAndClippedTextCannotSkipCloudReview() {
        val second = url.replace("aaa", "bbb")
        val tag = snapshot().copy(records = snapshot().records + InspectedRecord("uri", second, 70))
        assertFalse(SingleCardPolicy.canChange(tag, listOf(InspectedCard(url, "readMissing"))))
        assertTrue(SingleCardPolicy.canChange(tag, listOf(InspectedCard(url, "readMissing"), InspectedCard(second, "readMissing"))))
        assertFalse(SingleCardPolicy.canChange(snapshot().copy(records = listOf(InspectedRecord("text", "clipped\u2026", 4096))), emptyList()))
    }
    @Test fun recordedStateOrVersionChangesForceAnotherReview() {
        val old = Card("card", "U1", null, "", 1, "unbound", null, "", null, null)
        val result = InspectedCard(url, "readExhibition", old)
        assertTrue(SingleCardPolicy.reviewMatches(result, old))
        assertFalse(SingleCardPolicy.reviewMatches(result, old.copy(recordingId = "audio", version = 2, status = "bound")))
        assertFalse(SingleCardPolicy.reviewMatches(result, old.copy(version = 2)))
        assertFalse(SingleCardPolicy.reviewMatches(result, null))
        assertTrue(SingleCardPolicy.reviewMatches(InspectedCard(url, "readMissing"), null))
        assertFalse(SingleCardPolicy.reviewMatches(InspectedCard(url, "readMissing"), old))
    }
    @Test fun independentCreationUsesV3IdempotentRequest() {
        val body = singleCreateRequest("request")
        assertEquals("createCards", body.getString("action"))
        assertEquals(1, body.getInt("count"))
        assertEquals("request", body.getString("requestKey"))
        assertEquals(3, body.getInt("protocolVersion"))
        assertFalse(body.has("categoryId"))
    }
    @Test fun failedReadbackCannotMakeAWrittenUrlReusableOnAnotherChip() {
        for (code in listOf("TAG_LOST", "NFC_IO", "READBACK_MISMATCH", "FORMATTED_RETRY", null)) assertFalse(SingleCardPolicy.retryIsSafe(code))
        for (code in listOf("CHIP_CHANGED", "FOREIGN_TAG", "READ_ONLY", "CAPACITY", "INVALID_URL", "UNSUPPORTED", "JOB_CONFLICT")) assertTrue(SingleCardPolicy.retryIsSafe(code))
    }
    @Test fun translationsExistForReadFirstActions() {
        for (language in listOf("ja", "zh", "en")) for (key in listOf("singleReadFirst", "clearChip", "newChipUrl", "restoreChipUrl", "clearChipConfirm", "newChipConfirm", "sameChip", "chipChanged", "chipCleared", "recordingProtected", "singleReviewPreparation")) {
            assertTrue(key, key in Copy(language).availableKeys)
        }
    }
}

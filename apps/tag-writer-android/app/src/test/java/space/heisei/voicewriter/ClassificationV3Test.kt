package space.heisei.voicewriter

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ClassificationV3Test {
    private val url = "https://voice.heisei.space/#/t/abcdefghijklmnopqrstuv"
    private fun jobJson() = JSONObject().put("id", "job").put("tagId", "tag").put("label", "U000001")
        .put("inventoryLabel", "U000001").put("batch", JSONObject.NULL).put("categoryId", JSONObject.NULL)
        .put("visitorUrl", url).put("version", 1).put("status", "pending")

    @Test fun newPhysicalReadbackUsesV3Reports() {
        val report = Provisioning.readback(parseJob(jobJson()), listOf(url))
        assertEquals(3, reportJson(report).getInt("protocolVersion"))
    }

    @Test fun emptyCardsHaveNoCategoryOrBatch() {
        val job = parseJob(jobJson())
        assertNull(job.categoryId)
        assertEquals("", job.batch)
    }

    @Test fun emptyCardDisplayUsesStableInventoryEvenIfOldLabelExists() {
        val job = parseJob(jobJson().put("label", "A001"))
        assertEquals("U000001", job.displayLabel)
        assertEquals("261017-B003", job.copy(recordingStatus = "bound", serialNumber = "261017-B003").displayLabel)
    }

    @Test fun oldPendingResultsKeepOriginalProtocolAndCannotSync() {
        val old = parseReport(JSONObject().put("jobId", "job").put("version", 1).put("visitorUrl", url)
            .put("status", "verified").put("leaseToken", "old-lease"))
        assertEquals(2, old.protocolVersion)
        assertEquals(2, reportJson(old).getInt("protocolVersion"))
        assertFalse(Provisioning.canSync(old))
        assertTrue(Provisioning.canSync(old.copy(protocolVersion = 3)))
    }

    @Test fun jobRequestsUseV3AndUnifiedPoolWithoutCategory() {
        val jobs = jobsRequest(500)
        assertEquals(3, jobs.getInt("protocolVersion"))
        assertEquals(500, jobs.getInt("offset"))
        assertFalse(jobs.has("categoryId"))
        val next = leaseRequest(null, "device")
        assertEquals("nextJob", next.getString("action"))
        assertEquals(3, next.getInt("protocolVersion"))
        assertFalse(next.has("categoryId"))
        val single = leaseRequest("job", "device")
        assertEquals("leaseJob", single.getString("action"))
        assertEquals("job", single.getString("jobId"))
    }

    @Test fun boundCardKeepsNullableMetadataAndFormalDisplay() {
        val card = parseCard(JSONObject().put("id", "tag").put("label", "old-label").put("version", 2)
            .put("status", "bound").put("inventoryLabel", "U000001").put("categoryId", "00000000-0000-4000-8000-000000000002")
            .put("categoryCode", "B").put("batchDate", "2026-10-17").put("serialNumber", "261017-B003")
            .put("recording", JSONObject().put("id", "recording")))
        assertEquals("261017-B003", card.displayLabel)
        assertEquals("2026-10-17", card.batchDate)
        assertEquals("B", card.categoryCode)
        assertEquals("U000001", card.copy(recordingId = null).displayLabel)
        assertNull(parseCard(JSONObject().put("id", "tag").put("label", "legacy").put("version", 1)).categoryId)
    }

    @Test fun automaticModeDoesNotRequireCategory() {
        val flow = WriterFlow()
        flow.choose(true)
        flow.start("job", "lease", Long.MAX_VALUE)
        assertTrue(flow.canWrite)
    }

    @Test fun emptyCardsCannotBeMovedEvenInMixedSelections() {
        val empty = parseCard(JSONObject().put("id", "tag").put("label", "U000001").put("version", 1))
        assertFalse(Provisioning.canMove(listOf(empty)))
        assertFalse(Provisioning.canMove(listOf(empty, empty.copy(recordingId = "recording"))))
        assertTrue(Provisioning.canMove(listOf(empty.copy(recordingId = "recording"))))
    }

    @Test fun fixedCategoryCodesLocalizeWithoutUsingServerChineseNames() {
        assertEquals("A · Food", Copy("en").category(Category("id", "美食", "A")))
        assertEquals("B · 旅行", Copy("ja").category(Category("id", "旅行", "B")))
        assertEquals("C · 相遇", Copy("zh").category(Category("id", "相遇", "C")))
        assertEquals("D · Other Memories", Copy("en").category(Category("id", "其他回忆", "D")))
    }
}

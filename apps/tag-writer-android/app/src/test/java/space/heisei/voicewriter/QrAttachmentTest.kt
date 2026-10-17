package space.heisei.voicewriter

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class QrAttachmentTest {
    private val url = "https://voice.heisei.space/#/t/" + "a".repeat(48)
    @Test fun onlyBlankOrExactRetryCardCanBeUsed() {
        assertTrue(QrAttachmentPolicy.accepts(InspectedTag("empty", writable=true), url))
        assertTrue(QrAttachmentPolicy.accepts(InspectedTag("unformatted", writable=true), url))
        assertTrue(QrAttachmentPolicy.accepts(InspectedTag("data", listOf(InspectedRecord("uri",url,80)), true), url))
        assertFalse(QrAttachmentPolicy.accepts(InspectedTag("data", listOf(InspectedRecord("uri",url+"b",80)), true), url))
        assertFalse(QrAttachmentPolicy.accepts(InspectedTag("data", listOf(InspectedRecord("text","hello",5)), true), url))
        assertFalse(QrAttachmentPolicy.accepts(InspectedTag("empty", writable=false), url))
        assertFalse(QrAttachmentPolicy.accepts(InspectedTag("data", listOf(InspectedRecord("uri",url,80),InspectedRecord("text","hidden",5)),true), url))
        assertFalse(QrAttachmentPolicy.accepts(InspectedTag("empty", writable=true,truncated=true), url))
    }
    @Test fun reportKindSurvivesStorageAndSelectsCorrectEndpoint() {
        val report = Report("job",1,url,"verified",null,"lease",jobKind="qr")
        assertEquals(report, parseReport(reportJson(report)))
        assertEquals("provisionQrAttachment", provisionRequest(report).getString("action"))
        assertFalse(provisionRequest(report).has("jobKind"))
        val legacy = reportJson(report).apply { remove("jobKind") }
        assertEquals("nfc", parseReport(legacy).jobKind)
        assertEquals("provision", provisionRequest(parseReport(legacy)).getString("action"))
    }
    @Test fun parsesQrJobAndEligibleRecordedIdentity() {
        val json = JSONObject().put("id","job").put("tagId","tag").put("label","261018-A001").put("visitorUrl",url).put("version",1).put("tagVersion",2).put("recordingStatus","bound").put("status","pending").put("jobKind","qr")
        val job = parseJob(json)
        assertEquals("qr",job.jobKind)
        val card = parseCard(JSONObject().put("id","tag").put("label","261018-A001").put("version",2).put("status","bound").put("entryChannel","qr").put("recording",JSONObject().put("id","audio")).put("attachment",json))
        assertEquals(job,card.job)
        assertTrue(QrAttachmentPolicy.canPrepare(card))
        assertFalse(QrAttachmentPolicy.canPrepare(card.copy(recordingId=null)))
        assertFalse(QrAttachmentPolicy.canPrepare(card.copy(entryChannel="nfc")))
        assertFalse(QrAttachmentPolicy.canPrepare(card.copy(status="disabled")))
        assertFalse(QrAttachmentPolicy.canPrepare(card.copy(job=job.copy(status="verified"))))
        assertEquals("a".repeat(64).length,QrAttachmentPolicy.chipHash(byteArrayOf(1,2,3)).length)
        assertThrows(Exception::class.java) { QrAttachmentPolicy.chipHash(byteArrayOf()) }
    }
    @Test fun anotherDevicesLateSuccessAcknowledgesOnlyMatchingQrFailure() {
        val job = Job("job","tag","card","",url,1,"verified",null,jobKind="qr")
        val failed = Report("job",1,url,"failed","NFC_IO",jobKind="qr")
        assertTrue(Provisioning.canDiscardSuperseded(failed,job))
        assertFalse(Provisioning.canDiscardSuperseded(failed.copy(status="verified"),job))
        assertFalse(Provisioning.canDiscardSuperseded(failed.copy(visitorUrl=url+"b"),job))
        assertFalse(Provisioning.canDiscardSuperseded(failed.copy(version=2),job))
        assertFalse(Provisioning.canDiscardSuperseded(failed.copy(jobKind="nfc"),job.copy(jobKind="nfc")))
    }
}

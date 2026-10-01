package space.heisei.voicewriter
import org.junit.Assert.*
import org.junit.Test
class ProvisioningTest {
    private val url = "https://voice.heisei.space/#/t/abcdefghijklmnopqrstuv"
    private val job = Job("job", "tag", "01", "A", url, 3, "pending", null)
    @Test fun validatesOnlyCanonicalServerUrls() {
        assertTrue(Provisioning.validUrl(url))
        listOf(url.replace("https", "http"), url + "?x=1", url.replace("voice.heisei.space", "evil.example"), "https://voice.heisei.space/#/t/01").forEach { assertFalse(Provisioning.validUrl(it)) }
    }
    @Test fun exactReadbackIsRequired() {
        assertEquals("verified", Provisioning.readback(job, listOf(url)).status)
        assertEquals("failed", Provisioning.readback(job, listOf(url + "/")).status)
        assertEquals("failed", Provisioning.readback(job, listOf(url, url)).status)
    }
    @Test fun staleVersionsCannotBeReconciled() {
        val report = Provisioning.readback(job, listOf(url))
        assertTrue(Provisioning.matches(report, job))
        assertFalse(Provisioning.matches(report, job.copy(version = 4)))
        assertFalse(Provisioning.matches(report, job.copy(visitorUrl = url + "x")))
    }
    @Test fun failureNeverBecomesVerification() {
        assertEquals("failed", Provisioning.failure(job, "TAG_LOST").status)
        assertEquals(3, Provisioning.failure(job, "TAG_LOST").version)
    }
    @Test fun authoritativeVerificationSupersedesOnlyMatchingFailure() {
        val failed = Provisioning.failure(job, "TAG_LOST")
        assertTrue(Provisioning.superseded(failed, job.copy(status = "verified")))
        assertFalse(Provisioning.superseded(failed, job))
        assertFalse(Provisioning.superseded(failed, job.copy(status = "verified", version = 4)))
        assertFalse(Provisioning.superseded(Provisioning.readback(job, listOf(url)), job.copy(status = "verified")))
        assertEquals("failed", failed.status)
    }
    @Test fun backgroundingRequiresAnotherExplicitArm() {
        assertTrue(Provisioning.canArm(true, 1, 1))
        assertFalse(Provisioning.canArm(false, 1, 1))
        assertFalse(Provisioning.canArm(true, 1, 2))
    }
}

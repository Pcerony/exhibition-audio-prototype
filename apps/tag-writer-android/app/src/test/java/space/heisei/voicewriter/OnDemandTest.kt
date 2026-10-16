package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class OnDemandTest {
    @Test fun revocationResetsTransientWriteStateWithoutChangingDurablePreparation() {
        var disk: String? = null
        val memory = PreparationMemory({ disk }, { disk = it; true })
        val key = memory.requestKey()
        val session = WriterSessionState()
        session.preparationBlocked = true
        session.retryJobId = "operator-a-job"
        session.completed = 12
        session.reset()
        assertFalse(session.preparationBlocked)
        assertNull(session.retryJobId)
        assertEquals(0, session.completed)
        assertEquals(key, memory.requestKey())
    }
    @Test fun requestIsV3AndUsesStableUuid() {
        val body = prepareWriteRequest("device", "12345678-1234-4234-8234-123456789012")
        assertEquals("prepareWrite", body.getString("action"))
        assertEquals(3, body.getInt("protocolVersion"))
        assertEquals("device", body.getString("deviceId"))
        assertEquals("12345678-1234-4234-8234-123456789012", body.getString("requestKey"))
    }
    @Test fun requestSurvivesNetworkLossAndAccountScopesAreIndependent() {
        val disk = mutableMapOf<String, String>()
        fun memory(scope: String) = PreparationMemory({ disk[scope] }, { disk[scope] = it; true })
        val key = memory("server:user").requestKey()
        assertEquals(key, memory("server:user").requestKey())
        assertNotEquals(key, memory("server:other").requestKey())
        memory("server:user").accepted("job-a")
        assertEquals("job-a", memory("server:user").jobId())
        memory("server:user").completed("other")
        assertEquals("job-a", memory("server:user").jobId())
        memory("server:user").completed("job-a")
        assertNotEquals(key, memory("server:user").requestKey())
    }
    @Test fun failedPersistenceCannotConsumeARequest() {
        var value: String? = null
        val memory = PreparationMemory({ value }, { false })
        try { memory.requestKey(); fail("Must persist before network") } catch (_: IllegalStateException) { }
        val working = PreparationMemory({ value }, { value = it; true })
        val key = working.requestKey()
        try { memory.accepted("job"); fail("Must preserve request") } catch (_: IllegalStateException) { }
        assertEquals(key, working.requestKey())
    }
    @Test fun ineligibleRequestRequiresExplicitReviewedReset() {
        var disk: String? = null
        val memory = PreparationMemory({ disk }, { disk = it; true })
        val key = memory.requestKey()
        memory.resetReviewed()
        assertNotEquals(key, memory.requestKey())
        memory.accepted("failed-job")
        memory.resetReviewed()
        assertNull(memory.jobId())
    }
    @Test fun successRequiresDwellAndPhysicalRemovalAndPauseInvalidatesFeedback() {
        val gate = SuccessGate()
        gate.success(100)
        assertFalse(gate.advance(2000))
        gate.removed()
        assertFalse(gate.advance(500))
        assertTrue(gate.advance(1100))
        gate.cancel()
        assertFalse(gate.advance(5000))
        assertNotEquals(WriteFeedback.SUCCESS.icon, WriteFeedback.ERROR.icon)
        assertEquals("pendingCloud", WriteFeedback.PENDING.title)
    }
    @Test fun automaticRetryNeverUsesManualRewritePermissionForCompletedCard() {
        val job = Job("job", "tag", "U1", "", "https://voice.heisei.space/#/t/abcdefghijklmnopqrstuv", 1, "failed", null)
        assertTrue(WriterSafety.autoRetry(job))
        assertFalse(WriterSafety.autoRetry(job.copy(status = "verified")))
        assertFalse(WriterSafety.autoRetry(job.copy(recordingStatus = "bound")))
        var disk: String? = null
        val memory = PreparationMemory({ disk }, { disk = it; true })
        memory.accepted(job)
        assertTrue(memory.matches(job))
        assertFalse(memory.matches(job.copy(version = 2)))
        assertFalse(memory.matches(job.copy(tagVersion = 2)))
        assertFalse(memory.matches(job.copy(visitorUrl = "other")))
    }
    @Test fun interruptedPhysicalAttemptRequiresReviewButKnownFailureRetriesOriginalJob() {
        var disk: String? = null
        fun memory() = PreparationMemory({ disk }, { disk = it; true })
        memory().accepted("job")
        memory().beginPhysical("job")
        assertTrue(memory().physicalUncertain())
        memory().failedPhysical("other")
        assertTrue(memory().physicalUncertain())
        memory().failedPhysical("job")
        assertFalse(memory().physicalUncertain())
        assertEquals("job", memory().jobId())
    }
}

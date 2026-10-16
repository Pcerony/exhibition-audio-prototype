package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class WriterFlowTest {
    @Test fun automaticModeRequiresExplicitStartAndRemovalBetweenCards() {
        val flow = WriterFlow()
        flow.choose("food", true)
        assertFalse(flow.canWrite)
        flow.start("job", "lease", Long.MAX_VALUE)
        assertTrue(flow.canWrite)
        assertTrue(flow.begin("chip-a"))
        flow.verified()
        assertFalse(flow.canWrite)
        flow.removed()
        assertTrue(flow.readyForNext)
    }
    @Test fun backgroundingInvalidatesArmAndNeverAutomaticallyResumes() {
        val flow = WriterFlow()
        flow.choose("food", true)
        flow.start("job", "lease", Long.MAX_VALUE)
        flow.pause()
        assertFalse(flow.canWrite)
        assertFalse(flow.readyForNext)
    }
    @Test fun expiredLeaseNeverWritesAndRepeatedChipCannotAdvance() {
        val flow = WriterFlow()
        flow.choose("food", true)
        flow.start("job", "lease", 0)
        assertFalse(flow.begin("chip"))
        flow.start("job", "lease", Long.MAX_VALUE)
        assertTrue(flow.begin("chip"))
        flow.verified()
        assertFalse(flow.begin("chip"))
    }
    @Test fun foreignAssignedUrlIsNotSilentlyOverwritten() {
        assertTrue(WriterSafety.mayWrite(emptyList(), "https://voice.heisei.space/#/t/a"))
        assertTrue(WriterSafety.mayWrite(listOf("https://voice.heisei.space/#/t/a"), "https://voice.heisei.space/#/t/a"))
        assertFalse(WriterSafety.mayWrite(listOf("https://voice.heisei.space/#/t/b"), "https://voice.heisei.space/#/t/a"))
    }
    @Test fun managementChangesInvalidatePreflightEvenWhenJobVersionIsUnchanged() {
        val job = Job("job", "tag", "A001", "Food", "https://voice.heisei.space/#/t/abcdefghijklmnopqrstuv", 1, "pending", null)
        assertTrue(WriterSafety.sameAssignment(job, job))
        assertFalse(WriterSafety.sameAssignment(job, job.copy(categoryId = "other")))
        assertFalse(WriterSafety.sameAssignment(job, job.copy(recordingStatus = "bound")))
    }
    @Test fun defaultsToJapaneseAndHasCompleteThreeLanguageCatalog() {
        assertEquals("ja", Copy().language)
        assertEquals(Copy.keys, Copy("en").availableKeys)
        assertEquals(Copy.keys, Copy("zh").availableKeys)
        assertEquals(Copy.keys, Copy("ja").availableKeys)
        assertEquals("ja", Copy("unsupported").language)
    }
    @Test fun expiredLeaseTransitionsToActionablePause() {
        val flow = WriterFlow()
        flow.choose("food", true)
        flow.start("job", "lease", 10)
        assertTrue(flow.expire(11))
        assertEquals(WriterFlow.Stage.PAUSED, flow.stage)
        assertFalse(flow.expire(12))
    }
    @Test fun logoutInvalidatesAnInFlightSessionResponse() {
        val revision = SessionRevision()
        val inFlight = revision.current()
        assertTrue(revision.accepts(inFlight))
        revision.invalidate()
        assertFalse(revision.accepts(inFlight))
        var stored = false
        try { revision.apply(inFlight) { stored = true }; fail("Late session accepted") } catch (_: IllegalStateException) { }
        assertFalse(stored)
    }
}

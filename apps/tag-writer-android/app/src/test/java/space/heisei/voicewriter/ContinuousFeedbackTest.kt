package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class ContinuousFeedbackTest {
    @Test fun tagAlreadyGoneDoesNotRequireManualRestart() {
        val gate = SuccessGate()
        gate.success(100)
        gate.observeIgnoreResult(false)
        assertFalse(gate.advance(900))
        assertTrue(gate.advance(1100))
    }
    @Test fun presentTagStillRequiresPhysicalRemovalWithoutTimeoutFallback() {
        val gate = SuccessGate()
        gate.success(100)
        gate.observeIgnoreResult(true)
        assertFalse(gate.advance(60000))
        gate.removed()
        assertTrue(gate.advance(60000))
        gate.cancel()
        assertFalse(gate.advance(70000))
    }
    @Test fun advancingWhileWorkerBusyDoesNotConsumeRemoval() {
        val gate = SuccessGate()
        gate.success(0)
        gate.observeIgnoreResult(false)
        assertTrue(gate.advance(1000))
        assertTrue(gate.advance(1100))
    }
    @Test fun explicitEventVibrationRespectsSilentAndDoNotDisturb() {
        assertArrayEquals(longArrayOf(0, 80, 60, 120), FeedbackVibration.pattern(WriteFeedback.SUCCESS, true, false))
        assertArrayEquals(longArrayOf(0, 220), FeedbackVibration.pattern(WriteFeedback.ERROR, true, false))
        assertNull(FeedbackVibration.pattern(WriteFeedback.SUCCESS, false, false))
        assertNull(FeedbackVibration.pattern(WriteFeedback.SUCCESS, true, true))
        assertNull(FeedbackVibration.pattern(WriteFeedback.WRITING, true, false))
        assertNull(FeedbackVibration.pattern(WriteFeedback.READY, true, false))
    }
    @Test fun nextAutomaticTaskNeverOverwritesThePreviousTagsUrl() {
        val previous = "https://voice.heisei.space/#/t/" + "a".repeat(48)
        val next = "https://voice.heisei.space/#/t/" + "b".repeat(48)
        assertFalse(WriterSafety.mayWrite(listOf(previous), next))
        assertTrue(WriterSafety.mayWrite(listOf(previous), previous))
        val permission = OverwritePermission()
        permission.approve("job", "lease")
        assertFalse(permission.consume("job", "lease", true))
    }
}

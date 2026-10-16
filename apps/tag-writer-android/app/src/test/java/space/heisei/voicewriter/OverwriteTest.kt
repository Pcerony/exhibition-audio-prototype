package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class OverwriteTest {
    private val target = "https://voice.heisei.space/#/t/" + "a".repeat(48)
    @Test fun ordinaryWritesStillProtectExistingContents() {
        for (contents in listOf(listOf(""), listOf("https://example.invalid"), listOf(target, ""))) {
            assertFalse(WriterSafety.mayWrite(contents, target))
            assertTrue(WriterSafety.mayWrite(contents, target, true))
        }
        assertTrue(WriterSafety.mayWrite(emptyList(), target))
        assertTrue(WriterSafety.mayWrite(listOf(target), target))
    }
    @Test fun overwriteApprovalIsConsumedByOnlyTheExactManualLease() {
        val permission = OverwritePermission()
        assertFalse(permission.consume("job", "lease", false))
        permission.approve("job", "lease")
        assertFalse(permission.consume("job", "lease", true))
        permission.approve("job", "lease")
        assertFalse(permission.consume("other", "lease", false))
        permission.approve("job", "lease")
        assertFalse(permission.consume("job", "new-lease", false))
        permission.approve("job", "lease")
        assertTrue(permission.consume("job", "lease", false))
        assertFalse(permission.consume("job", "lease", false))
    }
    @Test fun cancellationAndPauseClearApproval() {
        val permission = OverwritePermission()
        permission.approve("job", "lease")
        permission.clear()
        assertFalse(permission.consume("job", "lease", false))
    }
    @Test fun pauseAfterConsumptionInvalidatesTheOriginalWriteEpochEvenAfterResume() {
        val permission = OverwritePermission()
        var epoch = 7
        val writeEpoch = epoch
        permission.approve("job", "lease")
        assertTrue(permission.consume("job", "lease", false))
        permission.clear()
        epoch++
        assertFalse(Provisioning.canArm(true, writeEpoch, epoch))
        assertFalse(permission.consume("job", "lease", false))
    }
    @Test fun overwriteCopyExistsInEveryLanguage() {
        for (language in listOf("ja", "zh", "en")) for (key in listOf("overwrite", "overwriteConfirm", "overwriteReady", "foreign")) {
            val copy = Copy(language)
            assertTrue(key in copy.availableKeys)
            assertNotEquals(copy["error"], copy[key])
        }
    }
}

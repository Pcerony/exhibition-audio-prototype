package space.heisei.voicewriter

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderModeTest {
    @Test fun keepsExclusiveModeThroughReadResultsAndOnlyReleasesOnExit() {
        val calls = mutableListOf<String>()
        val mode = ReaderMode({ calls.add("enable") }, { calls.add("disable") })
        mode.update(foreground = true, authenticated = true, nfcEnabled = true, readScreen = true, writing = false)
        // The read has finished and no write is armed. A redraw must not return control to Android.
        mode.update(foreground = true, authenticated = true, nfcEnabled = true, readScreen = true, writing = false)
        assertEquals(listOf("enable"), calls)
        mode.update(foreground = true, authenticated = true, nfcEnabled = true, readScreen = false, writing = false)
        assertEquals(listOf("enable", "disable"), calls)
    }

    @Test fun doesNotCaptureBackgroundOrUnauthenticatedTapsAndRearmsOnReturn() {
        val calls = mutableListOf<String>()
        val mode = ReaderMode({ calls.add("enable") }, { calls.add("disable") })
        mode.update(false, true, true, true, false)
        mode.update(true, false, true, true, false)
        mode.update(true, true, false, true, false)
        assertEquals(emptyList<String>(), calls)
        mode.update(true, true, true, true, false)
        mode.update(false, true, true, true, false)
        mode.update(true, true, true, false, true)
        assertEquals(listOf("enable", "disable", "enable"), calls)
    }
}

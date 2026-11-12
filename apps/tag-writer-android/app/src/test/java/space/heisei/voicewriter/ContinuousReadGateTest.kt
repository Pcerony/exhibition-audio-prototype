package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class ContinuousReadGateTest {
    @Test fun differentCardsDoNotWaitAndRepeatedDiscoveryIsDebounced() {
        val gate = ContinuousReadGate()
        assertTrue(gate.accept(byteArrayOf(1), 1000))
        assertFalse(gate.accept(byteArrayOf(1), 1010))
        assertTrue(gate.accept(byteArrayOf(2), 1020))
        assertFalse(gate.accept(byteArrayOf(2), 1030))
        assertTrue(gate.accept(byteArrayOf(2), 1770))
        gate.reset()
        assertTrue(gate.accept(byteArrayOf(2), 1771))
    }
}

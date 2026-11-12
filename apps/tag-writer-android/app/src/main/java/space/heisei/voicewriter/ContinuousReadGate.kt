package space.heisei.voicewriter

internal class ContinuousReadGate {
    private var lastId: ByteArray? = null
    private var lastAt = 0L

    @Synchronized fun accept(id: ByteArray, now: Long): Boolean {
        if (id.isNotEmpty() && lastId?.contentEquals(id) == true && now - lastAt < 750L) return false
        lastId = id.copyOf()
        lastAt = now
        return true
    }

    @Synchronized fun reset() { lastId = null }
}

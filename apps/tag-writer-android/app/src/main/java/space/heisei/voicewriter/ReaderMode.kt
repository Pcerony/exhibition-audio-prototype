package space.heisei.voicewriter

internal class ReaderMode(private val enable: () -> Unit, private val disable: () -> Unit) {
    private var active = false

    fun update(foreground: Boolean, authenticated: Boolean, nfcEnabled: Boolean, readScreen: Boolean, writing: Boolean) {
        val requested = foreground && authenticated && nfcEnabled && (readScreen || writing)
        if (active == requested) return
        if (requested) enable() else disable()
        active = requested
    }
}

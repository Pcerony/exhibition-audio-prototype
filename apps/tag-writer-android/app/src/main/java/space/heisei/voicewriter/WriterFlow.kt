package space.heisei.voicewriter

class WriterFlow {
    enum class Stage { IDLE, READY, WRITING, REMOVAL, NEXT, PAUSED }
    var stage = Stage.IDLE; private set
    var automatic = false; private set
    var categoryId = ""; private set
    var jobId = ""; private set
    var leaseToken = ""; private set
    var expiresAt = 0L; private set
    private var chip = ""
    val canWrite get() = stage == Stage.READY && System.currentTimeMillis() < expiresAt
    val readyForNext get() = automatic && stage == Stage.NEXT
    @Synchronized fun choose(category: String, auto: Boolean) { categoryId = category; automatic = auto; stage = Stage.IDLE; chip = "" }
    @Synchronized fun start(job: String, lease: String, expires: Long) { jobId = job; leaseToken = lease; expiresAt = expires; stage = Stage.READY }
    @Synchronized fun begin(identity: String): Boolean {
        if (!canWrite || identity == chip) return false
        chip = identity; stage = Stage.WRITING; return true
    }
    @Synchronized fun verified() { stage = Stage.REMOVAL }
    @Synchronized fun removed() { if (stage == Stage.REMOVAL) { chip = ""; stage = if (automatic) Stage.NEXT else Stage.IDLE } }
    @Synchronized fun pause() { stage = Stage.PAUSED }
    @Synchronized fun expire(now: Long): Boolean {
        if (stage != Stage.READY || now < expiresAt) return false
        stage = Stage.PAUSED
        return true
    }
}

class SessionRevision {
    private var value = 0L
    @Synchronized fun current() = value
    @Synchronized fun accepts(expected: Long) = expected == value
    @Synchronized fun invalidate() { value++ }
    @Synchronized fun apply(expected: Long, action: () -> Unit) {
        check(expected == value) { "AUTH_REQUIRED" }
        action()
    }
}

object WriterSafety {
    fun mayWrite(existingUris: List<String>, target: String) = existingUris.isEmpty() || existingUris == listOf(target)
    fun sameAssignment(original: Job, fresh: Job) = original.id == fresh.id && original.tagId == fresh.tagId &&
        original.version == fresh.version && original.tagVersion == fresh.tagVersion && original.visitorUrl == fresh.visitorUrl &&
        original.categoryId == fresh.categoryId && original.recordingStatus == fresh.recordingStatus
}

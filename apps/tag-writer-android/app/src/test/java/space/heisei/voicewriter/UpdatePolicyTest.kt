package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test

class UpdatePolicyTest {
    private fun manifest(code: Int = 10, url: String = "https://github.com/Pcerony/exhibition-audio-prototype/releases/download/v3.3.0-rc1/voice-writer-v3.3.0-candidate.apk") = """{"schemaVersion":1,"versionCode":$code,"versionName":"3.3.0","packageName":"space.heisei.voicewriter","minSdk":26,"url":"$url","size":3,"sha256":"${"a".repeat(64)}","notes":{"ja":"改善","zh":"改进","en":"Improved"}}"""
    @Test fun newerOnly() {
        assertNotNull(UpdatePolicy.parse(manifest(), 9, 36))
        assertNull(UpdatePolicy.parse(manifest(), 10, 36))
        assertNull(UpdatePolicy.parse(manifest(), 11, 36))
    }
    @Test fun persistedReportsBlockEvenBeforeLoginOrForAnotherAccount() {
        assertFalse(UpdatePolicy.hasPendingReports(mapOf("project:user:reports" to "[]", "language" to "ja")))
        assertTrue(UpdatePolicy.hasPendingReports(mapOf("project:other:reports" to "[{\"jobId\":\"fake\"}]")))
        assertTrue(UpdatePolicy.hasPendingReports(mapOf("project:user:reports" to "corrupt")))
    }
    @Test fun rejectsUntrustedManifest() {
        for (value in listOf(manifest(url="http://github.com/a"), manifest(url="https://github.com.evil.test/a"), manifest().replace("space.heisei.voicewriter", "evil.app"), manifest().replace("\"size\":3", "\"size\":999999999"), manifest().replace("\"minSdk\":26", "\"minSdk\":99"))) {
            assertThrows(Exception::class.java) { UpdatePolicy.parse(value, 9, 36) }
        }
    }
    @Test fun browserDownloadUsesVersionedFirstPartyFilename() {
        val update = UpdatePolicy.parse(manifest(), 9, 36)!!
        assertEquals("https://voice.heisei.space/updates/download/voice-writer-v3.3.0-candidate.apk", UpdatePolicy.browserDownload(update))
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.browserDownload(update.copy(url = "https://evil.test/a.apk")) }
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.browserDownload(update.copy(url = update.url + "?x=1")) }
    }
}

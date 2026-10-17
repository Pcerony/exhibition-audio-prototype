package space.heisei.voicewriter

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest

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
    @Test fun redirectAllowlist() {
        assertTrue(UpdatePolicy.allowedDownload("https://release-assets.githubusercontent.com/a?sig=test"))
        assertFalse(UpdatePolicy.allowedDownload("https://user@github.com/a"))
        assertFalse(UpdatePolicy.allowedDownload("https://evil.test/a"))
        assertFalse(UpdatePolicy.allowedDownload("http://release-assets.githubusercontent.com/a"))
    }
    @Test fun installerRejectsOtherPackagesSignersAndVersions() {
        assertTrue(UpdatePolicy.sameApplication(UpdatePolicy.PACKAGE, 10, 10, 9, setOf("a"), setOf("a")))
        assertFalse(UpdatePolicy.sameApplication("evil.app", 10, 10, 9, setOf("a"), setOf("a")))
        assertFalse(UpdatePolicy.sameApplication(UpdatePolicy.PACKAGE, 9, 10, 9, setOf("a"), setOf("a")))
        assertFalse(UpdatePolicy.sameApplication(UpdatePolicy.PACKAGE, 10, 10, 10, setOf("a"), setOf("a")))
        assertFalse(UpdatePolicy.sameApplication(UpdatePolicy.PACKAGE, 10, 10, 9, setOf("a"), setOf("b")))
        assertFalse(UpdatePolicy.sameApplication(UpdatePolicy.PACKAGE, 10, 10, 9, emptySet(), emptySet()))
    }
    @Test fun sizeAndDigestMustMatchAndPartialIsRemoved() {
        val file = File.createTempFile("update-test", ".apk")
        val bytes = byteArrayOf(1,2,3)
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        try {
            UpdatePolicy.copyVerified(ByteArrayInputStream(bytes), file, 3, hash) { }
            assertArrayEquals(bytes, file.readBytes())
            assertThrows(Exception::class.java) { UpdatePolicy.copyVerified(ByteArrayInputStream(bytes), file, 2, hash) { } }
            assertFalse(file.exists())
            assertThrows(Exception::class.java) { UpdatePolicy.copyVerified(ByteArrayInputStream(bytes), file, 3, "0".repeat(64)) { } }
            assertFalse(file.exists())
        } finally { file.delete() }
    }
}

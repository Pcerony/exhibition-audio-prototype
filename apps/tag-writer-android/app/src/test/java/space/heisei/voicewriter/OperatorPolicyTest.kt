package space.heisei.voicewriter

import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OperatorPolicyTest {
    @Test fun onlyResetAndDeleteCanBeSubmittedOrRetried() {
        assertEquals(listOf("reset", "delete"), OperatorPolicy.bulkOperations)
        assertTrue(OperatorPolicy.canSubmit("reset"))
        assertTrue(OperatorPolicy.canSubmit("delete"))
        assertFalse(OperatorPolicy.canSubmit("move"))
        assertFalse(OperatorPolicy.canSubmit(""))
    }

    @Test fun historicalMoveRequiresReviewInsteadOfRetry() {
        assertTrue(OperatorPolicy.requiresReview("move"))
        assertTrue(OperatorPolicy.requiresReview("unknown"))
        assertFalse(OperatorPolicy.requiresReview("reset"))
        assertFalse(OperatorPolicy.requiresReview("delete"))
    }

    @Test fun restoredHistoricalRequestIsPreservedAndCannotBeRetried() {
        val saved = """{"operation":"move","requestKey":"uncertain-request","cards":[{"id":"tag","version":3}],"targetCategoryId":"old-theme"}"""
        val pending = OperatorPolicy.restorePending { saved }!!
        assertEquals(JSONObject(saved).toString(), pending.toString())
        assertFalse(OperatorPolicy.canSubmit(pending.getString("operation")))
        assertSame(pending, OperatorPolicy.discardHistorical(pending) { false })
        assertEquals("uncertain-request", pending.getString("requestKey"))
    }

    @Test fun explicitDiscardRemovesOnlyCurrentAccountAndAllowsNewOperations() {
        val ownKey = OperatorPolicy.pendingKey("server-a", "operator-a")
        val otherKey = OperatorPolicy.pendingKey("server-a", "operator-b")
        val otherServer = OperatorPolicy.pendingKey("server-b", "operator-a")
        val storage = mutableMapOf(ownKey to """{"operation":"move"}""", otherKey to "other-pending", otherServer to "other-server")
        val pending = OperatorPolicy.restorePending { storage[ownKey] }!!
        assertNull(OperatorPolicy.discardHistorical(pending) { storage.remove(ownKey); true })
        assertEquals("other-pending", storage[otherKey])
        assertEquals("other-server", storage[otherServer])
        assertNull(OperatorPolicy.restorePending { storage[ownKey] })
        assertTrue(OperatorPolicy.canSubmit("reset"))
        assertTrue(OperatorPolicy.canSubmit("delete"))
    }

    @Test fun managementHasNoCategoryControlsOrFilteredRequests() {
        val source = File("src/main/java/space/heisei/voicewriter/MainActivity.kt").readText()
        assertFalse(source.contains("categoryPicker"))
        assertFalse(source.contains("selectMoveTarget"))
        assertFalse(source.contains("api.categories()"))
        assertTrue(source.contains("api.cards(\"\", search, sort, offset, statusFilter, batchDate)"))
        assertTrue(source.contains("if (!OperatorPolicy.canSubmit(body.optString(\"operation\")))"))
        assertTrue(source.contains("pendingBulk = OperatorPolicy.restorePending"))
        assertTrue(source.contains("pendingBulk = OperatorPolicy.discardHistorical"))
    }
}

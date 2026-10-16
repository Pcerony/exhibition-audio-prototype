package space.heisei.voicewriter

import org.json.JSONObject

object OperatorPolicy {
    val bulkOperations = listOf("reset", "delete")
    fun canSubmit(operation: String) = operation in bulkOperations
    fun requiresReview(operation: String) = !canSubmit(operation)
    fun pendingKey(server: String, owner: String) = "$server:$owner:bulk"
    fun restorePending(read: () -> String?) = read()?.let { JSONObject(it) }
    fun discardHistorical(pending: JSONObject, remove: () -> Boolean): JSONObject? =
        if (requiresReview(pending.optString("operation")) && remove()) null else pending
}

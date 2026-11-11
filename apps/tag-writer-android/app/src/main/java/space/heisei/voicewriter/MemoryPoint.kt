package space.heisei.voicewriter

import org.json.JSONObject

data class MemoryPoint(val lat: Double, val lng: Double) {
    init { require(lat in -90.0..90.0 && lng in -180.0..180.0) }
    fun json(): JSONObject = JSONObject().put("source", "pin").put("lat", lat).put("lng", lng)
}

data class MemoryMapLocation(val pin: MemoryPoint? = null, val placeId: String? = null) {
    fun json(): JSONObject = pin?.json() ?: JSONObject().put("source", "place").put("placeId", placeId)
}

data class BoardRecommendation(val state: String, val pieceCode: String?, val point: ModelPoint?, val confirmedPoint: MemoryPoint?)

internal fun parseMemoryMapLocation(json: JSONObject?): MemoryMapLocation? = runCatching {
    when (json?.optString("source")) {
        "pin" -> MemoryMapLocation(pin = MemoryPoint(json.getDouble("lat"), json.getDouble("lng")))
        "place" -> json.getString("placeId").takeIf { it.isNotBlank() && it.length <= 300 }?.let { MemoryMapLocation(placeId = it) }
        else -> null
    }
}.getOrNull()

internal fun parseBoardRecommendation(data: JSONObject): BoardRecommendation? = runCatching {
    val value = data.optJSONObject("recommendation") ?: return null
    if (value.optString("mapVersion") != PLACEMENT_MAP_VERSION) return null
    val state = value.getString("state")
    if (state !in setOf("assigned", "needs_review", "outside_map")) return null
    val code = value.nullableString("pieceCode")
    val point = code?.let { ModelPoint(value.getDouble("x"), value.getDouble("y")) }
    if (point != null && (point.x !in 0.0..1500.0 || point.y !in 0.0..1320.0)) return null
    BoardRecommendation(state, code, point, parseMemoryMapLocation(value.optJSONObject("confirmedLocation"))?.pin)
}.getOrNull()

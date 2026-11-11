package space.heisei.voicewriter

import org.json.JSONObject

internal const val PLACEMENT_MAP_VERSION = "fukuoka-road-73-v13"
data class ModelPoint(val x: Double, val y: Double)
data class TagPlacement(val pieceCode: String, val point: ModelPoint, val version: Int) {
    fun saveRequest(id: String): JSONObject = JSONObject().put("action", "saveTagPlacement").put("tagId", id)
        .put("mapVersion", PLACEMENT_MAP_VERSION).put("pieceCode", pieceCode)
        .put("x", point.x).put("y", point.y).put("expectedVersion", version)
}
internal fun parseTagPlacement(result: JSONObject): TagPlacement? {
    val p = result.optJSONObject("placement") ?: return null
    require(p.getString("mapVersion") == PLACEMENT_MAP_VERSION)
    return TagPlacement(p.getString("pieceCode"), ModelPoint(p.getDouble("x"), p.getDouble("y")), p.getInt("version"))
}

internal data class PlacementBoard(val code: String, val rings: List<List<ModelPoint>>) {
    fun contains(point: ModelPoint): Boolean {
        fun inside(ring: List<ModelPoint>): Boolean {
            var hit = false
            for (i in 1 until ring.size) {
                val a = ring[i - 1]; val b = ring[i]
                if ((a.y > point.y) != (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit
            }
            return hit
        }
        return inside(rings.first()) && rings.drop(1).none(::inside)
    }
}
internal class PlacementGeometry(json: JSONObject) {
    val width = json.getJSONArray("size").getDouble(0)
    val height = json.getJSONArray("size").getDouble(1)
    val boards: List<PlacementBoard>
    init {
        require(json.getString("version") == PLACEMENT_MAP_VERSION)
        val pieces = json.getJSONArray("pieces")
        boards = (0 until pieces.length()).map { i ->
            val piece = pieces.getJSONObject(i)
            val rings = piece.getJSONObject("geometry").getJSONArray("coordinates")
            PlacementBoard(piece.getString("code"), (0 until rings.length()).map { j ->
                val ring = rings.getJSONArray(j)
                (0 until ring.length()).map { k -> ring.getJSONArray(k).let { ModelPoint(it.getDouble(0), it.getDouble(1)) } }
            })
        }.sortedWith(compareBy({ it.code.first() }, { it.code.drop(1).toInt() }))
    }
}

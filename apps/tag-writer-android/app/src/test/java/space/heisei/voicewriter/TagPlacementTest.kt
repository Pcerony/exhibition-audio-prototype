package space.heisei.voicewriter

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class TagPlacementTest {
    @Test fun packagedGeometryHas73ClosedBoardOutlines() {
        val geometry = PlacementGeometry(JSONObject(File("../../../src/domain/map-piece-geometry-v13.json").readText()))
        assertEquals(73, geometry.boards.size)
        assertTrue(geometry.boards.all { board -> board.rings.all { it.size >= 4 && it.first() == it.last() } })
        assertFalse(geometry.boards.any { it.contains(ModelPoint(-1.0, 5.0)) })
    }
    @Test fun missingPlacementDoesNotUseRecordingLocation() {
        assertNull(parseTagPlacement(JSONObject("""{"placement":null,"tag":{"location":{"x":12,"y":34}}}""")))
    }
    @Test fun saveUsesModelCoordinatesAndOptimisticVersion() {
        val body = TagPlacement("A1", ModelPoint(12.5, 34.0), 0).saveRequest("id")
        assertEquals("saveTagPlacement", body.getString("action"))
        assertEquals("fukuoka-road-73-v13", body.getString("mapVersion"))
        assertEquals(0, body.getInt("expectedVersion"))
        assertEquals(12.5, body.getDouble("x"), 0.0)
        assertEquals(34.0, body.getDouble("y"), 0.0)
    }
}

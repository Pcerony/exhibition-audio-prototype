package space.heisei.voicewriter

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View

internal class PlacementMapView(
    context: Context, private val geometry: PlacementGeometry, private val selected: PlacementBoard?,
    private val zoom: Boolean, point: ModelPoint?, label: String,
    private val onPoint: ((ModelPoint) -> Unit)? = null,
) : View(context) {
    private var pin = point
    private val boards = if (zoom && selected != null) listOf(selected) else geometry.boards
    private val extent = if (zoom && selected != null) selected.rings.first() else listOf(ModelPoint(0.0,0.0), ModelPoint(geometry.width,geometry.height))
    private val left = extent.minOf { it.x }
    private val top = extent.maxOf { it.y }
    private val spanX = extent.maxOf { it.x } - left
    private val spanY = top - extent.minOf { it.y }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val density = resources.displayMetrics.density
    private var scale = 1.0
    private var offsetX = 0.0
    private var offsetY = 0.0

    init {
        contentDescription = label
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        isClickable = onPoint != null
        setBackgroundColor(Color.rgb(247,249,248))
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        scale = minOf((w - 24 * density) / spanX, (h - 24 * density) / spanY).coerceAtLeast(0.01)
        offsetX = (w - spanX * scale) / 2
        offsetY = (h - spanY * scale) / 2
    }
    private fun px(x: Double) = (offsetX + (x - left) * scale).toFloat()
    private fun py(y: Double) = (offsetY + (top - y) * scale).toFloat()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        for (board in boards) {
            val path = Path().apply { fillType = Path.FillType.EVEN_ODD }
            board.rings.forEach { ring ->
                path.moveTo(px(ring.first().x), py(ring.first().y))
                ring.drop(1).forEach { path.lineTo(px(it.x), py(it.y)) }
                path.close()
            }
            paint.style = Paint.Style.FILL
            paint.color = if (board == selected) Color.rgb(176,224,200) else Color.rgb(229,235,232)
            canvas.drawPath(path, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = density * if (board == selected) 2f else 0.65f
            paint.color = if (board == selected) Color.rgb(21,110,78) else Color.rgb(151,170,161)
            canvas.drawPath(path, paint)
        }
        pin?.let {
            paint.style = Paint.Style.FILL
            paint.color = Color.WHITE
            canvas.drawCircle(px(it.x), py(it.y), 8 * density, paint)
            paint.color = Color.rgb(175,47,28)
            canvas.drawCircle(px(it.x), py(it.y), 5 * density, paint)
        }
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val select = onPoint ?: return super.onTouchEvent(event)
        if (event.action == MotionEvent.ACTION_UP) {
            performClick()
            val point = ModelPoint((event.x-offsetX)/scale+left, top-(event.y-offsetY)/scale)
            if (selected?.contains(point) == true) {
                pin = point
                invalidate()
                select(point)
            }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}

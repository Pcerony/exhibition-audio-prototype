package space.heisei.voicewriter

import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

class WriteFeedbackDialog(private val activity: Activity, private val sound: () -> Boolean, private val saveSound: (Boolean) -> Unit) {
    private var dialog: AlertDialog? = null
    private var last: WriteFeedback? = null
    private var tone: ToneGenerator? = null
    private val handler = Handler(Looper.getMainLooper())
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    fun close() { handler.removeCallbacksAndMessages(null); dialog?.dismiss(); dialog = null; last = null; tone?.release(); tone = null }
    fun show(value: WriteFeedback, copy: Copy, label: String, detail: String = "", stop: () -> Unit) {
        val changed = last != value
        dialog?.dismiss()
        val body = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(20), dp(24), dp(20)); gravity = Gravity.CENTER_HORIZONTAL }
        fun text(value: String, size: Float) = TextView(activity).apply {
            text = value; textSize = size; gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(12))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; body.addView(this)
        }
        text(value.icon, 48f).setTextColor(if (value == WriteFeedback.ERROR || value == WriteFeedback.PENDING) android.graphics.Color.rgb(167, 40, 40) else android.graphics.Color.rgb(21, 110, 78))
        text(copy[value.title], 26f)
        if (label.isNotBlank()) text(label, 32f)
        text(copy[value.body], 18f)
        if (detail.isNotBlank()) text(detail, 17f)
        if (value == WriteFeedback.PREPARING || value == WriteFeedback.WRITING) body.addView(ProgressBar(activity))
        @Suppress("DEPRECATION")
        body.addView(Switch(activity).apply { text = copy["sound"]; isChecked = sound(); setOnCheckedChangeListener { _, checked -> saveSound(checked) } })
        val scroll = ScrollView(activity).apply { addView(body) }
        dialog = AlertDialog.Builder(activity).setView(scroll).setNegativeButton(copy["stop"]) { _, _ -> stop() }.setCancelable(false).create()
        dialog?.show()
        last = value
        if (changed) feedback(value, body)
    }
    @Suppress("DEPRECATION")
    private fun feedback(value: WriteFeedback, view: View) {
        if (value !in listOf(WriteFeedback.READY, WriteFeedback.SUCCESS, WriteFeedback.ERROR, WriteFeedback.PENDING)) return
        if (Settings.System.getInt(activity.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0) {
            val pattern = when (value) {
                WriteFeedback.ERROR, WriteFeedback.PENDING -> android.view.HapticFeedbackConstants.LONG_PRESS
                WriteFeedback.SUCCESS -> if (Build.VERSION.SDK_INT >= 30) android.view.HapticFeedbackConstants.CONFIRM else android.view.HapticFeedbackConstants.CONTEXT_CLICK
                else -> android.view.HapticFeedbackConstants.KEYBOARD_TAP
            }
            view.performHapticFeedback(pattern)
        }
        val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val notifications = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!sound() || audio.ringerMode != AudioManager.RINGER_MODE_NORMAL || notifications.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) return
        if (value == WriteFeedback.READY) return
        tone?.release()
        handler.removeCallbacksAndMessages(null)
        runCatching {
            val current = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60)
            tone = current
            current.startTone(if (value == WriteFeedback.SUCCESS) ToneGenerator.TONE_PROP_ACK else ToneGenerator.TONE_PROP_NACK, 180)
            handler.postDelayed({ current.release(); if (tone === current) tone = null }, 250)
        }
    }
}

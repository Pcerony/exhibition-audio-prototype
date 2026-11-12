package space.heisei.voicewriter

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Direct-distribution updater. Never uses the authenticated exhibition API. */
class AppUpdater(private val activity: Activity, private val copy: () -> Copy, private val idle: () -> Boolean) {
    private val worker = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)
    @Volatile private var closed = false
    @Volatile private var connection: HttpURLConnection? = null
    private var dialog: AlertDialog? = null
    private var candidate: AppUpdate? = null
    private var offered = false
    private val handler = Handler(Looper.getMainLooper())
    private val pendingOffer = object : Runnable {
        override fun run() {
            if (closed) return
            offer()
            if (!offered && candidate != null) handler.postDelayed(this, 2000)
        }
    }
    private fun t(key: String) = copy()[key]
    private fun ui(action: () -> Unit) = activity.runOnUiThread {
        if (!closed && !activity.isFinishing && !activity.isDestroyed) action()
    }
    private fun notice(key: String) { dialog = AlertDialog.Builder(activity).setMessage(t(key)).setPositiveButton(t("confirm"), null).show() }
    private fun connect(): HttpURLConnection {
        check(!closed && !Thread.currentThread().isInterrupted)
        val conn = URL(UpdatePolicy.FEED).openConnection() as HttpURLConnection
        connection = conn
        conn.instanceFollowRedirects = false; conn.connectTimeout = 15000; conn.readTimeout = 15000
        conn.setRequestProperty("Cache-Control", "no-cache")
        conn.setRequestProperty("Accept-Encoding", "identity")
        require(conn.responseCode == 200)
        return conn
    }
    fun check(manual: Boolean = false) {
        if (manual && !idle()) { notice("updateBusy"); return }
        if (!running.compareAndSet(false, true)) return
        if (manual) notice("updateChecking")
        worker.execute {
            try {
                val conn = connect()
                val raw = conn.inputStream.use { stream ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(4096)
                    while(true) { val n = stream.read(buffer); if(n < 0) break; require(output.size() + n <= 32768); output.write(buffer,0,n) }
                    output.toString("UTF-8")
                }
                candidate = UpdatePolicy.parse(raw, BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT)
            } catch (_: Exception) {
                candidate = null
                if(manual) ui { dialog?.dismiss(); notice("updateFailed") }
                return@execute
            }
            finally { connection?.disconnect(); running.set(false) }
            ui { if (manual) dialog?.dismiss(); if (candidate == null) { if(manual && idle()) notice("updateCurrent") } else { offer(manual); if(!offered) handler.postDelayed(pendingOffer, 2000) } }
        }
    }
    fun offer(manual: Boolean = false) {
        val update = candidate ?: return
        if (!idle() || (offered && !manual)) return
        offered = true
        dialog = AlertDialog.Builder(activity).setTitle("${t("updateAvailable")} ${update.name}")
            .setMessage(update.notes[copy().language])
            .setNegativeButton(t("updateLater"), null)
            .setPositiveButton(t("updateBrowserDownload")) { _, _ -> openDownload(update) }.show()
    }
    private fun openDownload(update: AppUpdate) {
        if (!idle()) { notice("updateBusy"); return }
        try { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(UpdatePolicy.browserDownload(update)))) }
        catch (_: android.content.ActivityNotFoundException) { notice("updateBrowserMissing") }
    }
    fun resume() { offer() }
    fun close() { closed = true; handler.removeCallbacks(pendingOffer); connection?.disconnect(); worker.shutdownNow(); dialog?.dismiss() }
}

package space.heisei.voicewriter

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.ProgressBar
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
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
    private val file get() = File(activity.cacheDir, "updates/update.apk")
    private fun t(key: String) = copy()[key]
    private fun ui(action: () -> Unit) = activity.runOnUiThread {
        if (!closed && !activity.isFinishing && !activity.isDestroyed) action()
    }
    private fun notice(key: String) { dialog = AlertDialog.Builder(activity).setMessage(t(key)).setPositiveButton(t("confirm"), null).show() }
    private fun connect(address: String, download: Boolean): HttpURLConnection {
        var next = address
        repeat(5) {
            check(!closed && !Thread.currentThread().isInterrupted)
            require(if (download) UpdatePolicy.allowedDownload(next) else next == UpdatePolicy.FEED)
            val conn = URL(next).openConnection() as HttpURLConnection
            connection = conn
            conn.instanceFollowRedirects = false; conn.connectTimeout = 15000; conn.readTimeout = 15000
            conn.setRequestProperty("Cache-Control", "no-cache")
            if (conn.responseCode in listOf(301,302,303,307,308) && download) {
                val location = conn.getHeaderField("Location") ?: error("redirect")
                next = URL(URL(next), location).toString(); conn.disconnect()
            } else { require(conn.responseCode == 200); return conn }
        }
        error("redirect")
    }
    fun check(manual: Boolean = false) {
        if (manual && !idle()) { notice("updateBusy"); return }
        if (!running.compareAndSet(false, true)) return
        if (manual) notice("updateChecking")
        worker.execute {
            try {
                val conn = connect(UpdatePolicy.FEED, false)
                val raw = conn.inputStream.use { stream ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(4096)
                    while(true) { val n = stream.read(buffer); if(n < 0) break; require(output.size() + n <= 32768); output.write(buffer,0,n) }
                    output.toString("UTF-8")
                }
                candidate = UpdatePolicy.parse(raw, BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT)
                ui { if (manual) dialog?.dismiss(); if (candidate == null) { if(manual && idle()) notice("updateCurrent") } else { offer(manual); if(!offered) handler.postDelayed(pendingOffer, 2000) } }
            } catch (_: Exception) { if(manual) ui { dialog?.dismiss(); notice("updateFailed") } }
            finally { connection?.disconnect(); running.set(false) }
        }
    }
    fun offer(manual: Boolean = false) {
        val update = candidate ?: return
        if (!idle() || (offered && !manual)) return
        offered = true
        dialog = AlertDialog.Builder(activity).setTitle("${t("updateAvailable")} ${update.name}")
            .setMessage(update.notes[copy().language])
            .setNegativeButton(t("updateLater"), null)
            .setPositiveButton(t("updateDownload")) { _, _ -> download(update) }.show()
    }
    private fun download(update: AppUpdate) {
        if (!idle()) { notice("updateBusy"); return }
        if (!running.compareAndSet(false, true)) return
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        dialog = AlertDialog.Builder(activity).setTitle(t("updateDownloading")).setView(progress).setCancelable(false).show()
        worker.execute {
            try {
                file.parentFile!!.mkdirs(); file.delete()
                val conn = connect(update.url, true)
                val length = conn.contentLengthLong
                require(length == -1L || length == update.size)
                conn.inputStream.use { UpdatePolicy.copyVerified(it, file, update.size, update.hash) { value -> ui { progress.progress = value } } }
                verifyPackage(update)
                ui { dialog?.dismiss(); installPrompt(update) }
            } catch (_: Exception) { file.delete(); ui { dialog?.dismiss(); notice("updateFailed") } }
            finally { connection?.disconnect(); running.set(false) }
        }
    }
    @Suppress("DEPRECATION")
    private fun verifyPackage(update: AppUpdate) {
        val pm = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.path, flags) ?: error("apk")
        val installed = pm.getPackageInfo(activity.packageName, flags)
        fun signatures(info: android.content.pm.PackageInfo): Set<String> {
            val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
            return signatures.orEmpty().map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { byte -> "%02x".format(byte) } }.toSet()
        }
        val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        require(UpdatePolicy.sameApplication(archive.packageName, code, update.code, BuildConfig.VERSION_CODE, signatures(installed), signatures(archive)))
        require(file.length() == update.size)
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buffer = ByteArray(32768); while(true) { val n = input.read(buffer); if(n < 0) break; digest.update(buffer,0,n) } }
        require(digest.digest().joinToString("") { "%02x".format(it) } == update.hash)
    }
    private fun installPrompt(update: AppUpdate) {
        if (!idle()) { notice("updateBusy"); return }
        dialog = AlertDialog.Builder(activity).setTitle(t("updateReady")).setMessage(t("updateInstallBody"))
            .setNegativeButton(t("updateLater"), null).setPositiveButton(t("updateInstall")) { _, _ ->
                if (!idle()) { notice("updateBusy"); return@setPositiveButton }
                try {
                    verifyPackage(update)
                    if (!activity.packageManager.canRequestPackageInstalls()) {
                        dialog = AlertDialog.Builder(activity).setMessage(t("updatePermission"))
                            .setNegativeButton(t("updateLater"), null).setPositiveButton(t("confirm")) { _, _ ->
                                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                            }.show()
                    } else {
                        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
                        activity.startActivity(Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                    }
                } catch (_: Exception) { notice("updateFailed") }
            }.show()
    }
    fun resume() { if (file.exists() && candidate != null && idle() && !running.get()) installPrompt(candidate!!) else offer() }
    fun close() { closed = true; handler.removeCallbacks(pendingOffer); connection?.disconnect(); worker.shutdownNow(); dialog?.dismiss() }
}

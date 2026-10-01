package space.heisei.voicewriter

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.nfc.*
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.content.Intent
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.*
import org.json.JSONArray
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity(), NfcAdapter.ReaderCallback {
    private val executor = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val api = Api()
    private var jobs = emptyList<Job>()
    private val queue = mutableListOf<Report>()
    @Volatile private var selected: Job? = null
    @Volatile private var paused = true
    private var resumed = false
    private var lifecycleEpoch = 0
    private var adapter: NfcAdapter? = null
    private lateinit var root: LinearLayout
    private lateinit var state: TextView
    private lateinit var batch: Spinner
    private lateinit var list: LinearLayout
    private fun text(en: String, ja: String, zh: String) = when (Locale.getDefault().language) { "ja" -> ja; "zh" -> zh; else -> en }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); adapter = NfcAdapter.getDefaultAdapter(this)
        val scroll = ScrollView(this)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 48, 24, 24) }
        root.setOnApplyWindowInsetsListener { view, insets ->
            view.setPadding(24 + insets.systemWindowInsetLeft, 24 + insets.systemWindowInsetTop, 24 + insets.systemWindowInsetRight, 24 + insets.systemWindowInsetBottom); insets
        }
        scroll.addView(root); setContentView(scroll); loginScreen()
    }
    private fun label(value: String) = TextView(this).apply { text = value; textSize = 18f; setPadding(0, 12, 0, 12); root.addView(this) }
    private fun button(value: String, action: () -> Unit) { root.addView(Button(this).apply { text = value; setOnClickListener { if (!busy.get()) action() } }) }
    private fun loginScreen() {
        root.removeAllViews(); label(text("Operator Login", "運営者ログイン", "运营者登录"))
        val email = EditText(this).apply { hint = "Email"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; root.addView(this) }
        val password = EditText(this).apply { hint = text("Password", "パスワード", "密码"); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; root.addView(this) }
        state = label("")
        button(text("Sign In", "ログイン", "登录")) { val e = email.text.toString(); val p = password.text.toString(); password.text.clear()
            work { api.login(e, p); restore(); jobs = api.jobs(); runOnUiThread { writerScreen() } }
        }
    }
    private fun writerScreen() {
        root.removeAllViews(); label(text("NFC Tag Writer", "NFC 展示タグ書き込み", "NFC 展签写入"))
        state = label("")
        batch = Spinner(this); root.addView(batch)
        val batches = jobs.map { it.batch }.distinct().sorted()
        batch.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, batches)
        batch.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { paused = true; selected = null; renderList(); reader() }
        }
        button(text("Refresh / Send Queued Reports", "更新・未送信結果を送る", "刷新 / 发送待同步结果")) { work { sync(); jobs = api.jobs(); runOnUiThread { paused = true; selected = null; writerScreen(); reader() } } }
        button(text("Resolve Stale Reports", "古い未送信結果を確認", "处理过期待同步结果")) {
            work { val fresh = api.jobs(); val stale = queue.filter { r -> fresh.none { Provisioning.matches(r, it) } || fresh.any { Provisioning.superseded(r, it) } }
                runOnUiThread { AlertDialog.Builder(this).setTitle(text("Discard stale reports?", "古い結果を破棄しますか？", "丢弃过期结果？"))
                    .setMessage(text("Changed/missing jobs or failed reports superseded by server verification", "変更・削除された作業、またはサーバー確認済みで不要になった失敗結果", "任务已变更或不存在，或服务端已验证而被取代的失败结果") + ": ${stale.size}\n" + stale.joinToString("\n") { it.jobId + " · v" + it.version })
                    .setNegativeButton(android.R.string.cancel, null).setPositiveButton(android.R.string.ok) { _, _ ->
                        work { queue.removeAll(stale.toSet()); check(persist()) { "LOCAL_SAVE_FAILED" }; jobs = fresh; runOnUiThread { selected = null; writerScreen() } }
                    }.show()
                }
            }
        }
        button(text("Pause", "一時停止", "暂停")) { paused = true; reader(); show() }
        button(text("Write / Retry Selected", "選択タグを書き込み・再試行", "写入 / 重试所选展签")) {
            val job = selected
            val armEpoch = lifecycleEpoch
            if (job != null && queue.none { it.jobId == job.id }) {
                work { val fresh = api.jobs().find { it.id == job.id } ?: throw WriterException("JOB_CONFLICT")
                    if (fresh.version != job.version || fresh.visitorUrl != job.visitorUrl || fresh.status !in listOf("pending", "failed")) throw WriterException("JOB_CONFLICT")
                    runOnUiThread { selected = fresh; paused = !Provisioning.canArm(resumed, armEpoch, lifecycleEpoch); reader(); show() }
                }
            }
        }
        button(text("Skip", "スキップ", "跳过")) { paused = true; selected = null; reader(); show() }
        button(text("NFC Settings", "NFC 設定", "NFC 设置")) { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) }
        button(text("Sign Out", "ログアウト", "退出登录")) { paused = true; reader(); api.token = ""; selected = null; jobs = emptyList(); queue.clear(); loginScreen() }
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; root.addView(this) }
        renderList(); show()
    }
    private fun renderList() {
        if (!::list.isInitialized) return
        list.removeAllViews()
        jobs.filter { it.batch == batch.selectedItem?.toString() && it.status in listOf("pending", "failed") }.forEach { job ->
            list.addView(Button(this).apply { text = "${job.label} · ${job.status} · v${job.version}"; setOnClickListener { if (!busy.get()) { selected = job; paused = true; reader(); show() } } })
        }
    }
    private fun show() {
        val job = selected
        state.text = text("Queued", "未送信", "待同步") + ": ${queue.size}\n" +
            (if (paused) text("Paused", "停止中", "已暂停") else text("Ready: touch one tag", "準備完了：タグをかざす", "就绪：靠近一枚芯片")) +
            "\n" + (job?.let { "${it.label} · v${it.version}\n${it.visitorUrl}" } ?: text("Select a tag", "タグを選択", "请选择展签")) +
            if (adapter?.isEnabled != true) "\n" + text("NFC unavailable or disabled", "NFC 非対応・無効", "NFC 不支持或未开启") else ""
    }
    override fun onResume() { super.onResume(); resumed = true; reader() }
    override fun onPause() { resumed = false; lifecycleEpoch++; paused = true; reader(); super.onPause() }
    override fun onDestroy() { executor.shutdown(); super.onDestroy() }
    private fun reader() {
        adapter?.disableReaderMode(this)
        if (resumed && !paused && api.token.isNotEmpty() && selected != null && adapter?.isEnabled == true) {
            adapter?.enableReaderMode(this, this, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V, null)
        }
    }
    override fun onTagDiscovered(tag: Tag) {
        val job = selected ?: return
        if (paused || !busy.compareAndSet(false, true)) return
        paused = true
        runOnUiThread { state.text = text("Writing… keep tag still", "書き込み中…タグを動かさない", "正在写入…请保持芯片静止") }
        executor.execute {
            val report = try { writeAndRead(tag, job) } catch (e: Exception) { Provisioning.failure(job, when(e) { is TagLostException -> "TAG_LOST"; is WriterException -> e.code; else -> "NFC_IO" }) }
            queue.add(report)
            val saved = persist()
            var message = if (saved) report.errorCode?.let { errorText(it) } ?: text("Readback passed; awaiting server", "読取一致・サーバー確認待ち", "读回一致，等待服务端确认") else errorText("LOCAL_SAVE_FAILED")
            if (saved) try { sync(); jobs = api.jobs(); message = if (report.status == "verified") text("Server confirmed. Remove tag and select next.", "確認済み。タグを離して次を選択。", "服务端已确认。移开芯片并选择下一项。") else errorText(report.errorCode.orEmpty()) } catch (_: Exception) { message = text("Report queued. Reconnect and retry sync.", "結果は未送信。接続後に再送。", "结果待同步。联网后重试发送。") }
            busy.set(false)
            runOnUiThread { reader(); if (jobs.any { it.id == job.id && it.status == "verified" }) selected = null; renderList(); show(); state.append("\n$message") }
        }
    }
    private fun writeAndRead(tag: Tag, job: Job): Report {
        if (!Provisioning.validUrl(job.visitorUrl)) throw WriterException("INVALID_URL")
        val message = NdefMessage(arrayOf(NdefRecord.createUri(job.visitorUrl)))
        val ndef = Ndef.get(tag)
        if (ndef != null) {
            try { ndef.connect(); if (!ndef.isWritable) throw WriterException("READ_ONLY"); if (ndef.maxSize < message.toByteArray().size) throw WriterException("CAPACITY"); ndef.writeNdefMessage(message) } finally { ndef.close() }
        } else {
            val format = NdefFormatable.get(tag) ?: throw WriterException("UNSUPPORTED")
            try { format.connect(); format.format(message) } finally { format.close() }
            // A newly formatted tag needs rediscovery before a fresh Ndef technology is available.
            throw WriterException("FORMATTED_RETRY")
        }
        try { ndef.connect(); val fresh = ndef.ndefMessage ?: throw WriterException("READBACK_MISMATCH")
            return Provisioning.readback(job, fresh.records.map { it.toUri()?.toString().orEmpty() })
        } finally { ndef.close() }
    }
    private fun prefs() = getSharedPreferences("writer", MODE_PRIVATE)
    private fun key() = BuildConfig.SUPABASE_URL + ":" + api.userId
    private fun persist(): Boolean = prefs().edit().putString(key(), JSONArray(queue.map { reportJson(it) }).toString()).commit()
    private fun restore() { queue.clear(); val data = JSONArray(prefs().getString(key(), "[]")); for (i in 0 until data.length()) { val r = data.getJSONObject(i); queue.add(Report(r.getString("jobId"), r.getInt("version"), r.getString("visitorUrl"), r.getString("status"), r.optString("errorCode").takeIf { it.isNotEmpty() })) } }
    private fun sync() {
        val authoritative = api.jobs()
        for (r in queue.toList()) {
            val job = authoritative.find { it.id == r.jobId } ?: throw WriterException("JOB_CONFLICT")
            if (!Provisioning.matches(r, job)) throw WriterException("JOB_CONFLICT")
            // Retain superseded failures for explicit discard; never submit them as verified.
            if (Provisioning.superseded(r, job)) continue
            api.report(r); queue.remove(r); check(persist()) { "LOCAL_SAVE_FAILED" }
        }
    }
    private fun work(action: () -> Unit) {
        if (!busy.compareAndSet(false, true)) return
        paused = true; reader(); state.text = text("Connecting…", "接続中…", "连接中…")
        executor.execute { try { action() } catch (e: Exception) { runOnUiThread { state.text = text("Connection / authorization failed", "接続・認証エラー", "连接或授权失败") + "\n" + safeError(e) } } finally { busy.set(false) } }
    }
    private fun safeError(e: Exception): String = e.message?.takeIf { Regex("[A-Z_0-9]{1,60}").matches(it) } ?: "NETWORK_ERROR"
    private fun errorText(code: String): String = when(code) {
        "CAPACITY" -> text("Tag capacity too small", "タグ容量不足", "芯片容量不足")
        "READ_ONLY" -> text("Tag is read-only", "書込禁止タグ", "芯片只读")
        "UNSUPPORTED" -> text("Unsupported tag", "非対応タグ", "不支持此芯片")
        "TAG_LOST" -> text("Tag removed; retry", "タグを離しました・再試行", "芯片已移开，请重试")
        "READBACK_MISMATCH" -> text("Readback did not match", "読取結果が不一致", "读回网址不一致")
        "FORMATTED_RETRY" -> text("Formatted. Remove tag and retry", "初期化済み。離して再試行", "已格式化，移开芯片后重试")
        "JOB_CONFLICT" -> text("Server job changed; contact operator", "作業情報が変更されました・管理者に連絡", "服务端任务已改变，请联系负责人")
        "LOCAL_SAVE_FAILED" -> text("Local save failed; do not exit", "保存失敗・アプリを閉じない", "本地保存失败，请勿退出")
        else -> text("Write failed", "書込失敗", "写入失败")
    } + " ($code)"
    class WriterException(val code: String) : Exception(code)
}

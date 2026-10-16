package space.heisei.voicewriter

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.MediaPlayer
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.TagLostException
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity(), NfcAdapter.ReaderCallback {
    private enum class Screen { CARDS, SINGLE, AUTO, EDIT }
    private val executor = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private val flow = WriterFlow()
    private lateinit var api: Api
    private lateinit var copy: Copy
    private lateinit var shell: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var state: TextView
    private var adapter: NfcAdapter? = null
    @Volatile private var resumed = false
    @Volatile private var epoch = 0
    @Volatile private var lease: Lease? = null
    private var screen = Screen.CARDS
    private var categories = emptyList<Category>()
    private var categoryId = ""
    private var cards = emptyList<Card>()
    private var jobs = emptyList<Job>()
    private var total = 0
    private var offset = 0
    private var search = ""
    private var sort = "recorded_desc"
    private var statusFilter = ""
    private var completed = 0
    private var statusMessage = ""
    private val checked = linkedSetOf<String>()
    private val queue = mutableListOf<Report>()
    private var pendingBulk: JSONObject? = null
    private var retryJobId: String? = null
    private var player: MediaPlayer? = null
    private val ink = Color.rgb(25, 40, 35)
    private val green = Color.rgb(21, 110, 78)
    private fun t(key: String) = copy[key]
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun prefs() = getSharedPreferences("operator-ui-v2", MODE_PRIVATE)
    private fun accountKey(suffix: String) = BuildConfig.SUPABASE_URL + ":" + api.userId + ":" + suffix

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        copy = Copy(prefs().getString("language", "ja").orEmpty())
        api = Api(SecureSession(this))
        api.onRevoked = { flow.pause(); epoch++; runOnUiThread { reader(); stopPlayback(); cards = emptyList(); jobs = emptyList(); checked.clear(); pendingBulk = null; queue.clear(); loginScreen() } }
        adapter = NfcAdapter.getDefaultAdapter(this)
        shell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(245, 248, 246)) }
        shell.setOnApplyWindowInsetsListener { view, insets ->
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        setContentView(shell)
        loginScreen()
        work { if (api.restore()) { restoreQueue(); load(); ui { render() } } }
        handler.postDelayed(autoSync, 15000)
        handler.postDelayed(checkLease, 1000)
    }

    private fun column(parent: LinearLayout, padding: Int = 0) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(padding), dp(padding), dp(padding), dp(padding)); parent.addView(this)
    }
    private fun text(parent: LinearLayout, value: String, size: Float = 16f, bold: Boolean = false): TextView = TextView(this).apply {
        text = value; textSize = size; setTextColor(ink); setPadding(0, dp(7), 0, dp(7))
        if (bold) setTypeface(typeface, Typeface.BOLD)
        parent.addView(this)
    }
    private fun action(parent: LinearLayout, title: String, primary: Boolean = false, callback: () -> Unit): Button = Button(this).apply {
        text = title; isAllCaps = false; minHeight = dp(48); textSize = 14f
        setTextColor(if (primary) Color.WHITE else green)
        backgroundTintList = android.content.res.ColorStateList.valueOf(if (primary) green else Color.rgb(230, 239, 233))
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(5) })
        setOnClickListener { if (!busy.get()) callback() }
    }
    private fun header(title: String, navigation: Boolean) {
        shell.removeAllViews()
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(20), dp(8), dp(12), dp(8)); setBackgroundColor(Color.WHITE); shell.addView(this) }
        TextView(this).apply { text = title; textSize = 21f; setTextColor(ink); setTypeface(typeface, Typeface.BOLD); top.addView(this, LinearLayout.LayoutParams(0, -2, 1f)) }
        top.addView(ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_preferences); contentDescription = t("menu"); background = null
            setOnClickListener { settings() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        if (navigation) {
            val nav = LinearLayout(this).apply { shell.addView(this) }
            Screen.entries.forEach { destination ->
                nav.addView(Button(this).apply {
                    val key = when(destination) { Screen.CARDS -> "cards"; Screen.SINGLE -> "single"; Screen.AUTO -> "auto"; Screen.EDIT -> "edit" }
                    text = t(key); textSize = 12f; isAllCaps = false; minHeight = dp(56); maxLines = 2
                    setTextColor(if (screen == destination) Color.WHITE else green)
                    backgroundTintList = android.content.res.ColorStateList.valueOf(if (screen == destination) green else Color.WHITE)
                    setOnClickListener { if (!busy.get()) navigate(destination) }
                }, LinearLayout.LayoutParams(0, dp(64), 1f))
            }
        }
        val scroll = ScrollView(this)
        shell.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(24)); scroll.addView(this) }
        state = text(content, statusMessage, 14f)
        state.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private fun loginScreen() {
        if (!::shell.isInitialized) return
        header(t("app"), false)
        text(content, t("login"), 26f, true)
        val email = EditText(this).apply { hint = t("email"); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; content.addView(this) }
        val password = EditText(this).apply { hint = t("password"); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; content.addView(this) }
        action(content, t("login"), true) {
            val address = email.text.toString().trim(); val secret = password.text.toString(); password.text.clear()
            work { api.login(address, secret); restoreQueue(); load(); ui { render() } }
        }
    }
    private fun settings() {
        val items = if (api.token.isBlank()) arrayOf(t("language"), t("nfc")) else arrayOf(api.email, t("language"), t("nfc"), t("logout"))
        AlertDialog.Builder(this).setTitle(t("menu")).setItems(items) { _, index ->
            val real = if (api.token.isBlank()) index + 1 else index
            when(real) {
                1 -> AlertDialog.Builder(this).setTitle(t("language")).setSingleChoiceItems(arrayOf("日本語", "中文", "English"), listOf("ja", "zh", "en").indexOf(copy.language)) { dialog, value ->
                    copy = Copy(listOf("ja", "zh", "en")[value]); prefs().edit().putString("language", copy.language).apply(); dialog.dismiss()
                    if (api.token.isBlank()) loginScreen() else render()
                }.show()
                2 -> startActivity(Intent(Settings.ACTION_NFC_SETTINGS))
                3 -> {
                    pauseWriting()
                    lease = null
                    retryJobId = null
                    api.logout()
                    statusMessage = ""
                    loginScreen()
                }
            }
        }.show()
    }
    private fun navigate(destination: Screen) {
        pauseWriting(); stopPlayback(); checked.clear(); retryJobId = null; offset = 0; screen = destination
        flow.choose(categoryId, destination == Screen.AUTO)
        work { releaseCurrent(); load(); ui { render() } }
    }
    private fun load() {
        api.verify(); sync()
        categories = api.categories()
        if (categoryId.isNotEmpty() && categories.none { it.id == categoryId }) categoryId = ""
        val page = api.cards(categoryId, search, sort, offset, statusFilter)
        cards = page.first; total = page.second; jobs = api.jobs(categoryId)
    }
    private fun categoryPicker(parent: LinearLayout, all: Boolean = true, changed: (String) -> Unit) {
        text(parent, t("category"), 13f, true)
        val choices = if (all) listOf(Category("", t("all"), "")) + categories else categories
        val picker = Spinner(this)
        picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, choices.map { if (it.id.isEmpty()) it.name else it.toString() })
        picker.setSelection(choices.indexOfFirst { it.id == categoryId }.coerceAtLeast(0))
        parent.addView(picker, LinearLayout.LayoutParams(-1, dp(52)))
        var initial = true
        picker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (initial) { initial = false; return }
                val value = choices.getOrNull(position)?.id ?: return
                if (value != categoryId && !busy.get()) changed(value)
            }
        }
    }
    private fun render() {
        if (api.token.isBlank()) { loginScreen(); return }
        header(t("app"), true)
        categoryPicker(content) { value ->
            pauseWriting(); categoryId = value; checked.clear(); retryJobId = null; offset = 0; flow.choose(value, screen == Screen.AUTO)
            work { releaseCurrent(); load(); ui { render() } }
        }
        if (queue.isNotEmpty()) {
            text(content, "${queue.size} · ${t("unsynced")}", 14f)
            action(content, t("review")) { reviewQueue() }
        }
        when(screen) {
            Screen.AUTO -> renderAuto()
            Screen.SINGLE -> renderSingle()
            Screen.CARDS, Screen.EDIT -> renderCards()
        }
        reader()
    }
    private fun renderCards() {
        val query = EditText(this).apply { hint = t("search"); setSingleLine(); setText(search); content.addView(this) }
        action(content, t("search")) { search = query.text.toString().trim(); offset = 0; checked.clear(); reload() }
        val orders = listOf("recorded_desc", "recorded_asc", "number")
        val order = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf(t("newest"), t("oldest"), t("number"))); setSelection(orders.indexOf(sort)) }
        content.addView(order)
        var initialOrder = true
        order.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (initialOrder) { initialOrder = false; return }
                if (!busy.get() && sort != orders[position]) { sort = orders[position]; offset = 0; checked.clear(); reload() }
            }
        }
        val filters = listOf("", "unbound", "bound", "disabled")
        val filter = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf(t("all"), t("empty"), t("recorded"), t("disabled"))); setSelection(filters.indexOf(statusFilter)) }
        content.addView(filter)
        var initialFilter = true
        filter.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (initialFilter) { initialFilter = false; return }
                if (!busy.get() && statusFilter != filters[position]) { statusFilter = filters[position]; offset = 0; checked.clear(); reload() }
            }
        }
        action(content, t("refresh")) { checked.clear(); reload() }
        if (screen == Screen.EDIT) {
            text(content, "${t("selected")}: ${checked.size}", 15f, true)
            action(content, t("move")) { selectMoveTarget() }
            action(content, t("reset")) { bulkPreview("reset") }
            action(content, t("delete")) { bulkPreview("delete") }
            pendingBulk?.let { action(content, t("retryOperation")) { applyPending() } }
        }
        text(content, "${offset + if (cards.isEmpty()) 0 else 1}–${offset + cards.size} / $total", 13f)
        if (cards.isEmpty()) text(content, t("noCards"))
        cards.forEach { card ->
            val panel = column(content, 12)
            panel.background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(6).toFloat(); setStroke(dp(1), Color.rgb(218, 227, 220)) }
            (panel.layoutParams as LinearLayout.LayoutParams).bottomMargin = dp(10)
            if (screen == Screen.EDIT) {
                panel.addView(CheckBox(this).apply {
                    text = card.label; textSize = 20f; isChecked = card.id in checked
                    setOnCheckedChangeListener { _, selected -> if (selected) checked.add(card.id) else checked.remove(card.id) }
                })
            } else text(panel, card.label, 23f, true)
            text(panel, card.categoryName, 13f)
            val job = jobs.find { it.tagId == card.id }
            text(panel, "${t(if (card.status == "disabled") "disabled" else if (card.recordingId == null) "empty" else "recorded")} · ${t(job?.status ?: "pending")}", 14f, true)
            if (card.nickname.isNotBlank()) text(panel, card.nickname, 14f)
            card.recordedAt?.let { text(panel, "${t("recordedAt")} · ${date(it)}", 13f) }
            job?.writtenAt?.let { text(panel, "${t("writtenAt")} · ${date(it)}", 13f) }
            if (card.recordingId != null) action(panel, t("play")) { play(card.recordingId) }
        }
        if (offset > 0) action(content, t("previous")) { offset = (offset - 50).coerceAtLeast(0); checked.clear(); reload() }
        if (offset + cards.size < total) action(content, t("next")) { offset += 50; checked.clear(); reload() }
    }
    private fun renderSingle() {
        text(content, t("single"), 25f, true)
        renderWriteState()
        jobs.filter { it.recordingStatus != "disabled" }.forEach { job ->
            action(content, "${job.label} · ${t(job.status)} · ${t(if (job.recordingStatus == "bound") "recorded" else "empty")}") {
                val begin = { arm(job.id) }
                if (job.status == "verified") AlertDialog.Builder(this).setTitle(t("rewrite")).setMessage(job.label).setNegativeButton(t("cancel"), null).setPositiveButton(t("confirm")) { _, _ -> begin() }.show()
                else begin()
            }
        }
        if (jobs.isEmpty()) text(content, t("noCards"))
    }
    private fun renderAuto() {
        text(content, t("auto"), 25f, true)
        val count = jobs.count { it.categoryId == categoryId && it.status == "pending" && it.recordingStatus == "unbound" }
        text(content, "${t("remaining")}: $count · ${t("completed")}: $completed", 16f, true)
        renderWriteState()
        retryJobId?.let { retry ->
            action(content, t("retryCurrent"), true) { arm(retry) }
            action(content, t("skip")) { retryJobId = null; arm(null) }
        }
        action(content, t(if (flow.stage == WriterFlow.Stage.PAUSED) "continue" else "start"), true) {
            if (categoryId.isEmpty()) { message(t("selectCategory")); return@action }
            arm(null)
        }.isEnabled = retryJobId == null && categoryId.isNotEmpty() && flow.stage !in listOf(WriterFlow.Stage.WRITING, WriterFlow.Stage.REMOVAL, WriterFlow.Stage.READY)
        action(content, t("pause")) { pauseWriting(); work { releaseCurrent(); ui { render() } } }
    }
    private fun renderWriteState() {
        val current = lease
        if (current != null) { text(content, current.job.label, 36f, true); text(content, current.job.batch, 16f) }
        val key = when(flow.stage) {
            WriterFlow.Stage.READY -> "ready"; WriterFlow.Stage.WRITING -> "writing"; WriterFlow.Stage.REMOVAL -> "remove"
            WriterFlow.Stage.PAUSED -> "paused"; else -> if (screen == Screen.AUTO) "selectCategory" else "selectCard"
        }
        text(content, t(key), 18f, true)
        if (adapter?.isEnabled != true) { text(content, t("nfcOff")); action(content, t("nfc")) { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) } }
    }
    private fun arm(jobId: String?) {
        if (queue.isNotEmpty()) { message(t("unsynced")); return }
        if (adapter?.isEnabled != true) { message(t("nfcOff")); return }
        val startEpoch = epoch
        work {
            releaseCurrent(); api.verify()
            val acquired = api.lease(categoryId, jobId, deviceId())
            if (acquired == null) { ui { message(t("done")) }; return@work }
            if (!resumed || startEpoch != epoch) { api.release(acquired); return@work }
            lease = acquired
            retryJobId = null
            flow.choose(categoryId, screen == Screen.AUTO)
            flow.start(acquired.job.id, acquired.token, acquired.expiresAt)
            ui { statusMessage = ""; render() }
        }
    }
    private fun pauseWriting() { epoch++; flow.pause(); reader() }
    private fun releaseCurrent() {
        val old = lease ?: return
        lease = null
        if (queue.none { it.jobId == old.job.id }) runCatching { api.release(old) }
    }
    private fun reader() {
        adapter?.disableReaderMode(this)
        if (resumed && api.token.isNotBlank() && flow.stage in listOf(WriterFlow.Stage.READY, WriterFlow.Stage.REMOVAL) && adapter?.isEnabled == true) {
            adapter?.enableReaderMode(this, this, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V, null)
        }
    }
    override fun onTagDiscovered(tag: Tag) {
        val current = lease ?: return
        if (!resumed || !busy.compareAndSet(false, true)) return
        val chipId = tag.id.joinToString("") { "%02x".format(it) }
        if (!flow.begin(chipId)) { busy.set(false); return }
        val writeEpoch = epoch
        val writeOwner = api.userId
        val reportKey = accountKey("reports")
        ui { message(t("writing")) }
        executor.execute {
            try {
                api.verify()
                val fresh = api.jobs(current.job.categoryId).find { it.id == current.job.id }
                if (fresh == null || !WriterSafety.sameAssignment(current.job, fresh)) throw WriterException("JOB_CONFLICT")
                if (!resumed || epoch != writeEpoch) throw WriterException("JOB_CONFLICT")
            } catch (e: Exception) {
                flow.pause(); busy.set(false); ui { reader(); message(error(e)) }; return@execute
            }
            val report = try {
                NfcWriter.writeAndRead(tag, current.job) { resumed && epoch == writeEpoch && System.currentTimeMillis() < current.expiresAt }
            } catch (e: Exception) {
                Provisioning.failure(current.job, when(e) { is TagLostException -> "TAG_LOST"; is WriterException -> e.code; is ApiException -> e.code; else -> "NFC_IO" })
            }.copy(leaseToken = current.token)
            if (api.userId != writeOwner) {
                val saved = JSONArray(prefs().getString(reportKey, "[]"))
                saved.put(reportJson(report))
                val persisted = prefs().edit().putString(reportKey, saved.toString()).commit()
                flow.pause()
                busy.set(false)
                ui { loginScreen(); if (!persisted) message(t("saveFailed")) }
                return@execute
            }
            queue.add(report)
            try {
                persistQueue()
                sync()
                if (queue.contains(report)) throw WriterException("JOB_CONFLICT")
                if (report.status != "verified") throw WriterException(report.errorCode ?: "NFC_IO")
                completed++
                if (resumed && epoch == writeEpoch) {
                    flow.verified()
                    ui {
                        message(t("remove"))
                        // Android's ignore callback only fires once this physical tag has left the field.
                        val accepted = adapter?.ignore(tag, 800, {
                            if (resumed && epoch == writeEpoch && flow.stage == WriterFlow.Stage.REMOVAL) {
                                flow.removed(); lease = null
                                if (flow.readyForNext) arm(null) else reload()
                            }
                        }, handler) == true
                        if (!accepted) { pauseWriting(); message(t("paused")) }
                    }
                } else flow.pause()
            } catch (e: Exception) {
                flow.pause()
                retryJobId = current.job.id
                ui { message(if (queue.isNotEmpty()) t("unsynced") else error(e)); render() }
            } finally { busy.set(false) }
        }
    }
    private fun persistQueue() {
        check(prefs().edit().putString(accountKey("reports"), JSONArray(queue.map { reportJson(it) }).toString()).commit()) { "LOCAL_SAVE_FAILED" }
    }
    private fun restoreQueue() {
        queue.clear()
        val array = JSONArray(prefs().getString(accountKey("reports"), "[]"))
        for (i in 0 until array.length()) {
            val r = array.getJSONObject(i)
            queue.add(Report(r.getString("jobId"), r.getInt("version"), r.getString("visitorUrl"), r.getString("status"), r.optString("errorCode").takeUnless { it.isBlank() || it == "null" }, r.optString("leaseToken")))
        }
        pendingBulk = prefs().getString(accountKey("bulk"), null)?.let { JSONObject(it) }
    }
    private fun sync() {
        if (queue.isEmpty()) return
        val authoritative = api.jobs()
        for (report in queue.toList()) {
            val job = authoritative.find { it.id == report.jobId }
            if (job == null || !Provisioning.matches(report, job) || Provisioning.superseded(report, job)) continue
            try { api.report(report); queue.remove(report); persistQueue() }
            catch (e: ApiException) {
                if (e.code !in listOf("LEASE_EXPIRED", "LEASE_CONFLICT", "VERSION_CONFLICT", "JOB_CONFLICT", "JOB_INELIGIBLE")) throw e
            }
        }
    }
    private val autoSync = object : Runnable {
        override fun run() {
            if (resumed && api.token.isNotBlank() && queue.isNotEmpty() && !busy.get()) work {
                val before = queue.size; sync()
                if (before != queue.size) ui { statusMessage = if (queue.isEmpty()) t("paused") else t("unsynced"); render() }
            }
            handler.postDelayed(this, 15000)
        }
    }
    private val checkLease = object : Runnable {
        override fun run() {
            if (resumed && flow.expire(System.currentTimeMillis())) {
                reader()
                statusMessage = t("expired")
                render()
            }
            handler.postDelayed(this, 1000)
        }
    }
    private fun reviewQueue() {
        val report = queue.firstOrNull() ?: return
        AlertDialog.Builder(this).setTitle(t("review")).setMessage("${t("stale")}\n\n${report.visitorUrl}\n${t("version")}: ${report.version}")
            .setNegativeButton(t("cancel"), null).setNeutralButton(t("retry")) { _, _ -> work { sync(); ui { render() } } }
            .setPositiveButton(t("discard")) { _, _ -> work {
                queue.remove(report); persistQueue(); ui { render() }
            } }.show()
    }
    private fun selectMoveTarget() {
        if (checked.isEmpty()) { message(t("selectCard")); return }
        AlertDialog.Builder(this).setTitle(t("move")).setItems(categories.map { it.toString() }.toTypedArray()) { _, index -> bulkPreview("move", categories[index].id) }.show()
    }
    private fun bulkPreview(operation: String, target: String? = null) {
        if (checked.isEmpty()) { message(t("selectCard")); return }
        if (pendingBulk != null) { message(t("retryOperation")); return }
        val ids = checked.toList()
        work {
            val body = JSONObject().put("action", "bulkPreview").put("tagIds", JSONArray(ids)).put("operation", operation)
            target?.let { body.put("targetCategoryId", it) }
            val groups = api.admin(body).getJSONArray("groups")
            ui { confirmGroup(groups, 0, operation, target) }
        }
    }
    private fun confirmGroup(groups: JSONArray, index: Int, operation: String, target: String?) {
        if (index >= groups.length()) { checked.clear(); reload(); return }
        val group = groups.getJSONObject(index); val rows = group.getJSONArray("cards")
        if (rows.length() == 0) { confirmGroup(groups, index + 1, operation, target); return }
        val kind = group.getString("kind")
        val description = t(if (kind == "recorded") "recordedConfirm" else "emptyConfirm")
        val detail = if (operation == "reset") t("resetConfirm") else if (operation == "move") t("moveConfirm") else ""
        val names = (0 until rows.length()).take(12).joinToString(", ") { rows.getJSONObject(it).optString("label") }
        AlertDialog.Builder(this).setTitle("${t(operation)} · ${rows.length()}").setMessage("$description\n$detail\n\n$names")
            .setNegativeButton(t("cancel")) { _, _ -> confirmGroup(groups, index + 1, operation, target) }
            .setPositiveButton(t("confirm")) { _, _ ->
                pendingBulk = JSONObject().put("action", "bulkApply").put("operation", operation).put("cards", rows).put("kind", kind).put("requestKey", UUID.randomUUID().toString()).apply { target?.let { put("targetCategoryId", it) } }
                if (!prefs().edit().putString(accountKey("bulk"), pendingBulk.toString()).commit()) { message(t("saveFailed")); return@setPositiveButton }
                applyPending { confirmGroup(groups, index + 1, operation, target) }
            }.show()
    }
    private fun applyPending(then: (() -> Unit)? = null) {
        val body = pendingBulk ?: return
        work {
            try { api.admin(body) }
            catch (e: ApiException) {
                if (e.code in listOf("VERSION_CONFLICT", "GROUP_CONFLICT", "TAG_NOT_FOUND")) { pendingBulk = null; prefs().edit().remove(accountKey("bulk")).commit() }
                throw e
            }
            pendingBulk = null; prefs().edit().remove(accountKey("bulk")).commit()
            load(); ui { message(t("success")); if (then == null) render() else then() }
        }
    }
    private fun play(recordingId: String) {
        stopPlayback()
        work {
            val url = api.admin(JSONObject().put("action", "playback").put("recordingId", recordingId)).getString("url")
            ui {
                val audio = MediaPlayer(); player = audio
                try {
                    audio.setDataSource(url)
                    audio.setOnPreparedListener { if (resumed && player === it) it.start() else it.release() }
                    audio.setOnErrorListener { _, _, _ -> stopPlayback(); message(t("error")); true }
                    audio.setOnCompletionListener { stopPlayback() }
                    audio.prepareAsync()
                    AlertDialog.Builder(this).setTitle(t("play")).setPositiveButton(t("stop")) { _, _ -> stopPlayback() }.setOnCancelListener { stopPlayback() }.show()
                } catch (_: Exception) { stopPlayback(); message(t("error")) }
            }
        }
    }
    private fun stopPlayback() { player?.release(); player = null }
    private fun reload() { work { load(); ui { render() } } }
    private fun deviceId(): String {
        prefs().getString("device", null)?.let { return it }
        return UUID.randomUUID().toString().also { prefs().edit().putString("device", it).commit() }
    }
    private fun date(value: String): String = runCatching {
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
    }.getOrDefault(value)
    private fun message(value: String) { statusMessage = value; if (::state.isInitialized) state.text = value }
    private fun ui(action: () -> Unit) { runOnUiThread { if (!isFinishing && !isDestroyed) action() } }
    private fun work(action: () -> Unit) {
        if (!busy.compareAndSet(false, true)) return
        message(t("loading"))
        executor.execute {
            try { action() }
            catch (e: Exception) { flow.pause(); ui { reader(); message(error(e)) } }
            finally { busy.set(false) }
        }
    }
    private fun error(e: Exception): String = t(when(e.message) {
        "AUTH_REQUIRED", "OPERATOR_REQUIRED", "invalid_credentials" -> "auth"
        "CAPACITY" -> "capacity"; "READ_ONLY" -> "readOnly"; "FOREIGN_TAG" -> "foreign"
        "UNSUPPORTED" -> "unsupported"; "TAG_LOST" -> "lost"; "READBACK_MISMATCH", "INVALID_URL" -> "mismatch"
        "FORMATTED_RETRY" -> "formatted"; "LEASE_CONFLICT" -> "leased"; "CLIENT_UPGRADE_REQUIRED" -> "upgrade"
        "JOB_CONFLICT", "VERSION_CONFLICT", "GROUP_CONFLICT", "JOB_INELIGIBLE", "LEASE_EXPIRED" -> "conflict"
        "LOCAL_SAVE_FAILED" -> "saveFailed"; else -> "error"
    })
    override fun onResume() {
        super.onResume(); resumed = true; reader()
        if (::api.isInitialized && api.token.isNotBlank() && !busy.get()) reload()
    }
    override fun onPause() {
        resumed = false; pauseWriting(); stopPlayback()
        if (::api.isInitialized && api.token.isNotBlank()) executor.execute { releaseCurrent() }
        super.onPause()
    }
    override fun onDestroy() { handler.removeCallbacks(autoSync); handler.removeCallbacks(checkLease); executor.shutdown(); super.onDestroy() }
}

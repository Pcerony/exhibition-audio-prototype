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
    private enum class Screen { CARDS, READ, SINGLE, AUTO, EDIT }
    private val executor = Executors.newSingleThreadExecutor()
    private val readExecutor = Executors.newSingleThreadExecutor()
    private val lookupExecutor = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private val flow = WriterFlow()
    private val overwritePermission = OverwritePermission()
    private val successGate = SuccessGate()
    private lateinit var feedback: WriteFeedbackDialog
    private lateinit var api: Api
    private lateinit var copy: Copy
    private lateinit var shell: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var state: TextView
    private var adapter: NfcAdapter? = null
    @Volatile private var resumed = false
    @Volatile private var epoch = 0
    @Volatile private var lease: Lease? = null
    @Volatile private var screen = Screen.CARDS
    @Volatile private var scanArmed = false
    private var inspectedTag: InspectedTag? = null
    private var inspectedCards = emptyList<InspectedCard>()
    private var queryingEpoch: Int? = null
    private var cards = emptyList<Card>()
    private var jobs = emptyList<Job>()
    private var total = 0
    private var offset = 0
    private var search = ""
    private var sort = "recorded_desc"
    private var statusFilter = ""
    private var batchDate = ""
    private val writeSession = WriterSessionState()
    private var statusMessage = ""
    private val checked = linkedSetOf<String>()
    private val queue = mutableListOf<Report>()
    private var pendingBulk: JSONObject? = null
    private var player: MediaPlayer? = null
    private val ink = Color.rgb(25, 40, 35)
    private val green = Color.rgb(21, 110, 78)
    private fun t(key: String) = copy[key]
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun prefs() = getSharedPreferences("operator-ui-v2", MODE_PRIVATE)
    private fun accountKey(suffix: String) = BuildConfig.SUPABASE_URL + ":" + api.userId + ":" + suffix
    private fun bulkKey() = OperatorPolicy.pendingKey(BuildConfig.SUPABASE_URL, api.userId)
    private fun preparation(owner: String = api.userId): PreparationMemory {
        val key = BuildConfig.SUPABASE_URL + ":" + owner + ":prepare"
        return PreparationMemory({ prefs().getString(key, null) }, { prefs().edit().putString(key, it).commit() })
    }
    private fun showFeedback(value: WriteFeedback, expected: Int = epoch, detail: String = "") {
        if (!resumed || epoch != expected || api.token.isBlank()) return
        feedback.show(value, copy, lease?.job?.displayLabel.orEmpty(), detail) {
            pauseWriting(); message(t("stopWrite")); render()
            executor.execute { releaseCurrent() }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        copy = Copy(prefs().getString("language", "ja").orEmpty())
        feedback = WriteFeedbackDialog(this, { prefs().getBoolean("sound", true) }, { prefs().edit().putBoolean("sound", it).apply() })
        api = Api(SecureSession(this))
        api.onRevoked = { overwritePermission.clear(); flow.pause(); epoch++; runOnUiThread { writeSession.reset(); lease = null; statusMessage = ""; feedback.close(); successGate.cancel(); scanArmed = false; inspectedTag = null; inspectedCards = emptyList(); reader(); stopPlayback(); cards = emptyList(); jobs = emptyList(); checked.clear(); pendingBulk = null; queue.clear(); loginScreen() } }
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
            listOf(listOf(Screen.CARDS, Screen.READ), listOf(Screen.SINGLE, Screen.AUTO, Screen.EDIT)).forEach { destinations ->
                val nav = LinearLayout(this).apply { shell.addView(this) }
                destinations.forEach { destination ->
                    nav.addView(Button(this).apply {
                        val key = when(destination) { Screen.CARDS -> "cards"; Screen.READ -> "readNfc"; Screen.SINGLE -> "single"; Screen.AUTO -> "auto"; Screen.EDIT -> "edit" }
                        text = t(key); textSize = 12f; isAllCaps = false; minHeight = dp(56); maxLines = 2
                        setTextColor(if (screen == destination) Color.WHITE else green)
                        backgroundTintList = android.content.res.ColorStateList.valueOf(if (screen == destination) green else Color.WHITE)
                        setOnClickListener { if (!busy.get()) navigate(destination) }
                    }, LinearLayout.LayoutParams(0, dp(56), 1f))
                }
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
        val items = if (api.token.isBlank()) arrayOf(t("language"), t("nfc"), t("sound")) else arrayOf(api.email, t("language"), t("nfc"), t("logout"), t("sound"))
        AlertDialog.Builder(this).setTitle(t("menu")).setItems(items) { _, index ->
            val real = if (api.token.isBlank()) index + 1 else index
            if ((api.token.isBlank() && index == 2) || (api.token.isNotBlank() && index == 4)) {
                AlertDialog.Builder(this).setTitle(t("sound")).setMultiChoiceItems(arrayOf(t("sound")), booleanArrayOf(prefs().getBoolean("sound", true))) { _, _, checked -> prefs().edit().putBoolean("sound", checked).apply() }.setPositiveButton(t("confirm"), null).show()
                return@setItems
            }
            when(real) {
                1 -> AlertDialog.Builder(this).setTitle(t("language")).setSingleChoiceItems(arrayOf("日本語", "中文", "English"), listOf("ja", "zh", "en").indexOf(copy.language)) { dialog, value ->
                    copy = Copy(listOf("ja", "zh", "en")[value]); prefs().edit().putString("language", copy.language).apply(); dialog.dismiss()
                    if (api.token.isBlank()) loginScreen() else render()
                }.show()
                2 -> startActivity(Intent(Settings.ACTION_NFC_SETTINGS))
                3 -> {
                    pauseWriting()
                    lease = null
                    writeSession.retryJobId = null
                    api.logout()
                    statusMessage = ""
                    loginScreen()
                }
            }
        }.show()
    }
    private fun navigate(destination: Screen) {
        pauseWriting(); stopPlayback(); checked.clear(); writeSession.retryJobId = null; offset = 0; screen = destination
        flow.choose(destination == Screen.AUTO)
        if (destination == Screen.READ) {
            inspectedTag = null; inspectedCards = emptyList(); scanArmed = true; statusMessage = ""
            executor.execute { releaseCurrent() }
            render(); return
        }
        scanArmed = false; inspectedTag = null; inspectedCards = emptyList()
        work { releaseCurrent(); load(); ui { render() } }
    }
    private fun load() {
        api.verify(); sync()
        if (screen == Screen.CARDS || screen == Screen.EDIT) {
            val page = api.cards("", search, sort, offset, statusFilter, batchDate)
            cards = page.first; total = page.second
        }
        jobs = api.jobs()
    }
    private fun render() {
        if (api.token.isBlank()) { loginScreen(); return }
        header(t("app"), true)
        if (screen == Screen.READ) { renderReader(); reader(); return }
        pendingBulk?.takeIf { OperatorPolicy.requiresReview(it.optString("operation")) }?.let {
            text(content, t("historicalBulkSummary"), 14f, true)
            action(content, t("reviewHistoricalBulk")) { reviewHistoricalBulk() }
        }
        if (queue.isNotEmpty()) {
            text(content, "${queue.size} · ${t("unsynced")}", 14f)
            if (queue.any { !Provisioning.canSync(it) }) text(content, t("legacyPendingSummary"), 14f, true)
            action(content, t("review")) { reviewQueue() }
        }
        when(screen) {
            Screen.AUTO -> renderAuto()
            Screen.SINGLE -> renderSingle()
            Screen.CARDS, Screen.EDIT -> renderCards()
            Screen.READ -> Unit
        }
        reader()
    }
    private fun renderReader() {
        text(content, t("readNfc"), 25f, true)
        if (adapter?.isEnabled != true) {
            text(content, t("nfcOff"))
            action(content, t("nfc")) { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) }
        }
        val snapshot = inspectedTag
        if (snapshot == null) text(content, t("readReady"), 18f, true)
        else {
            text(content, t("readContents"), 18f, true)
            text(content, t(when(snapshot.kind) { "empty" -> "readEmpty"; "unformatted" -> "readUnformatted"; "unsupported" -> "unsupported"; "failed" -> "readFailed"; else -> "readContents" }), 16f)
            snapshot.writable?.let { text(content, t(if (it) "readWritable" else "readReadOnly"), 13f) }
            snapshot.records.forEachIndexed { index, record ->
                text(content, "${index + 1} · ${t(when(record.kind) { "uri" -> "readUri"; "text" -> "readText"; "empty" -> "readEmptyRecord"; else -> "readOther" })} · ${record.bytes} B", 13f, true)
                if (record.value.isNotEmpty()) text(content, NfcInspection.display(record.value), 14f).setTextIsSelectable(true)
            }
            if (snapshot.truncated || snapshot.records.any { it.value.endsWith("\u2026") }) text(content, t("readTruncated"), 13f)
            if (snapshot.kind == "data" && inspectedCards.isEmpty()) text(content, t("readExternal"), 16f)
            inspectedCards.forEach { result ->
                val card = result.card
                text(content, t(result.state), 17f, true)
                if (card != null) {
                    text(content, card.displayLabel, 28f, true)
                    text(content, cardMetadata(card), 15f)
                    text(content, t(if (card.status == "disabled") "disabled" else if (card.recordingId == null) "empty" else "recorded"), 16f, true)
                    card.job?.let { job -> text(content, t(job.status), 14f); job.writtenAt?.let { text(content, "${t("writtenAt")} · ${date(it)}", 13f) } }
                    if (card.nickname.isNotBlank()) text(content, card.nickname, 15f)
                    card.recordedAt?.let { text(content, "${t("recordedAt")} · ${date(it)}", 13f) }
                    card.recordingId?.let { id -> action(content, t("play")) { play(id) } }
                }
                text(content, result.url, 12f).setTextIsSelectable(true)
            }
            if (inspectedCards.isNotEmpty() && queryingEpoch != epoch) action(content, t("readRetry")) { lookupInspection() }
        }
        action(content, t("readAgain"), true) {
            epoch++; stopPlayback(); inspectedTag = null; inspectedCards = emptyList(); scanArmed = true; statusMessage = ""; render()
        }
    }
    private fun inspectionCurrent(expectedEpoch: Int, owner: String) =
        NfcInspection.current(resumed, screen == Screen.READ, expectedEpoch, epoch, owner, api.userId) && api.token.isNotBlank()

    private fun readTag(tag: Tag) {
        if (!resumed || !scanArmed || !busy.compareAndSet(false, true)) return
        scanArmed = false
        val readEpoch = epoch
        val owner = api.userId
        readExecutor.execute {
            try {
                val snapshot = try { NfcReader.read(tag) } catch (_: TagLostException) { InspectedTag("lost") } catch (_: Exception) { InspectedTag("failed") }
                ui {
                    if (inspectionCurrent(readEpoch, owner)) {
                        inspectedTag = snapshot
                        inspectedCards = emptyList()
                        statusMessage = if (snapshot.kind == "lost") t("lost") else ""
                        lookupInspection()
                        render()
                    }
                }
            } finally { busy.set(false) }
        }
    }
    private fun lookupInspection() {
        val urls = inspectedTag?.let { NfcInspection.urls(it.records) }.orEmpty()
        if (urls.isEmpty() || queryingEpoch == epoch) return
        val readEpoch = epoch; val owner = api.userId
        queryingEpoch = readEpoch
        inspectedCards = urls.map { InspectedCard(it, "readCloud") }; render()
        lookupExecutor.execute {
            try { lookupInspectionResults(urls, readEpoch, owner) }
            finally { ui {
                if (queryingEpoch == readEpoch) queryingEpoch = null
                if (inspectionCurrent(readEpoch, owner)) render()
            } }
        }
    }
    private fun lookupInspectionResults(urls: List<String>, readEpoch: Int, owner: String) {
        val results = mutableListOf<InspectedCard>()
        for (url in urls) {
            if (!inspectionCurrent(readEpoch, owner)) return
            val result = try {
                val card = api.inspect(url)
                InspectedCard(url, if (card == null) "readMissing" else "readExhibition", card)
            } catch (_: Exception) { InspectedCard(url, "readUnknown") }
            results.add(result)
            val visible = results.toList() + urls.drop(results.size).map { InspectedCard(it, "readCloud") }
            ui { if (inspectionCurrent(readEpoch, owner)) { inspectedCards = visible; render() } }
        }
    }
    private fun renderCards() {
        val dateQuery = EditText(this).apply { hint = t("batchDate"); setSingleLine(); setText(batchDate); inputType = InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE; content.addView(this) }
        action(content, t("filterDate")) {
            val value = dateQuery.text.toString().trim()
            if (value.isNotEmpty() && runCatching { java.time.LocalDate.parse(value) }.isFailure) { message(t("invalidDate")); return@action }
            batchDate = value; offset = 0; checked.clear(); reload()
        }
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
            OperatorPolicy.bulkOperations.forEach { operation -> action(content, t(operation)) { bulkPreview(operation) } }
            pendingBulk?.takeIf { OperatorPolicy.canSubmit(it.optString("operation")) }?.let { action(content, t("retryOperation")) { applyPending() } }
        }
        text(content, "${offset + if (cards.isEmpty()) 0 else 1}–${offset + cards.size} / $total", 13f)
        if (cards.isEmpty()) text(content, t("noCards"))
        cards.forEach { card ->
            val panel = column(content, 12)
            panel.background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(6).toFloat(); setStroke(dp(1), Color.rgb(218, 227, 220)) }
            (panel.layoutParams as LinearLayout.LayoutParams).bottomMargin = dp(10)
            if (screen == Screen.EDIT) {
                panel.addView(CheckBox(this).apply {
                    text = card.displayLabel; textSize = 20f; isChecked = card.id in checked
                    setOnCheckedChangeListener { _, selected -> if (selected) checked.add(card.id) else checked.remove(card.id) }
                })
            } else text(panel, card.displayLabel, 23f, true)
            text(panel, cardMetadata(card), 13f)
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
            action(content, "${job.displayLabel} · ${t(job.status)} · ${t(if (job.recordingStatus == "bound") "recorded" else "empty")}") {
                pauseWriting()
                val selectionEpoch = epoch
                val owner = api.userId
                val allowed = { resumed && screen == Screen.SINGLE && epoch == selectionEpoch && api.userId == owner && owner.isNotBlank() }
                AlertDialog.Builder(this).setTitle(job.displayLabel).setMessage(job.batchDate ?: job.batch)
                    .setNegativeButton(t("cancel"), null)
                    .setPositiveButton(t("write")) { _, _ -> if (allowed()) arm(job.id) }
                    .setNeutralButton(t("overwrite")) { _, _ ->
                        AlertDialog.Builder(this).setTitle("${t("overwrite")} · ${job.displayLabel}")
                            .setMessage(t("overwriteConfirm"))
                            .setNegativeButton(t("cancel"), null)
                            .setPositiveButton(t("confirm")) { _, _ -> if (allowed()) arm(job.id, true) }.show()
                    }.show()
            }
        }
        if (jobs.isEmpty()) text(content, t("noCards"))
    }
    private fun renderAuto() {
        text(content, t("auto"), 25f, true)
        text(content, "${t("completed")}: ${writeSession.completed}", 16f, true)
        renderWriteState()
        if (writeSession.preparationBlocked) action(content, t("reviewPreparation")) {
            AlertDialog.Builder(this).setTitle(t("reviewPreparation")).setMessage(t("stale"))
                .setNegativeButton(t("cancel"), null).setPositiveButton(t("confirm")) { _, _ ->
                    runCatching { preparation().resetReviewed() }.onSuccess { writeSession.preparationBlocked = false; writeSession.retryJobId = null; render() }.onFailure { message(t("saveFailed")) }
                }.show()
        }
        writeSession.retryJobId?.let { retry ->
            action(content, t("retryCurrent"), true) { arm(retry) }
        }
        action(content, t(if (flow.stage == WriterFlow.Stage.PAUSED) "continue" else "start"), true) {
            arm(null)
        }.isEnabled = !writeSession.preparationBlocked && writeSession.retryJobId == null && flow.stage !in listOf(WriterFlow.Stage.WRITING, WriterFlow.Stage.REMOVAL, WriterFlow.Stage.READY)
        action(content, t("pause")) { pauseWriting(); work { releaseCurrent(); ui { render() } } }
    }
    private fun renderWriteState() {
        val current = lease
        if (current != null) { text(content, current.job.displayLabel, 36f, true); text(content, current.job.batchDate ?: current.job.batch, 16f) }
        val key = when(flow.stage) {
            WriterFlow.Stage.READY -> "ready"; WriterFlow.Stage.WRITING -> "writing"; WriterFlow.Stage.REMOVAL -> "remove"
            WriterFlow.Stage.PAUSED -> "paused"; else -> if (screen == Screen.AUTO) "unifiedPool" else "selectCard"
        }
        text(content, t(key), 18f, true)
        if (current != null && overwritePermission.pending(current.job.id, current.token) && flow.stage == WriterFlow.Stage.READY) text(content, t("overwriteReady"), 16f, true)
        if (adapter?.isEnabled != true) { text(content, t("nfcOff")); action(content, t("nfc")) { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) } }
    }
    private fun arm(jobId: String?, overwriteConfirmed: Boolean = false) {
        if (queue.isNotEmpty()) { message(t("unsynced")); return }
        if (adapter?.isEnabled != true) { message(t("nfcOff")); return }
        val startEpoch = epoch
        val automatic = screen == Screen.AUTO
        val owner = api.userId
        showFeedback(WriteFeedback.PREPARING, startEpoch)
        work {
            releaseCurrent(); api.verify()
            val memory = preparation(owner)
            val target = jobId ?: if (automatic) memory.jobId() else null
            if (automatic && target != null) {
                val fresh = api.jobs().find { it.id == target }
                if (fresh == null || !WriterSafety.autoRetry(fresh) || !memory.matches(fresh) || memory.physicalUncertain()) throw WriterException("JOB_INELIGIBLE")
            }
            val acquired = if (target == null && automatic) api.prepareWrite(deviceId(), memory.requestKey()) else api.lease(target, deviceId())
            if (acquired == null) { ui { if (resumed && startEpoch == epoch) { feedback.close(); message(t("done")) } }; return@work }
            if (automatic) memory.accepted(acquired.job)
            if (!resumed || startEpoch != epoch) { api.release(acquired); return@work }
            lease = acquired
            if (overwriteConfirmed && screen == Screen.SINGLE && jobId == acquired.job.id) overwritePermission.approve(acquired.job.id, acquired.token)
            writeSession.retryJobId = null
            flow.choose(automatic)
            flow.start(acquired.job.id, acquired.token, acquired.expiresAt)
            ui { if (resumed && startEpoch == epoch) { statusMessage = ""; render(); showFeedback(WriteFeedback.READY, startEpoch) } }
        }
    }
    private fun pauseWriting() { overwritePermission.clear(); epoch++; flow.pause(); successGate.cancel(); feedback.close(); reader() }
    private fun releaseCurrent() {
        overwritePermission.clear()
        val old = lease ?: return
        lease = null
        if (queue.none { it.jobId == old.job.id }) runCatching { api.release(old) }
    }
    private fun reader() {
        adapter?.disableReaderMode(this)
        if (resumed && api.token.isNotBlank() && ((screen == Screen.READ && scanArmed) || (screen != Screen.READ && flow.stage in listOf(WriterFlow.Stage.READY, WriterFlow.Stage.REMOVAL))) && adapter?.isEnabled == true) {
            val flags = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V
            adapter?.enableReaderMode(this, this, flags or if (screen == Screen.READ) 0 else NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS, null)
        }
    }
    override fun onTagDiscovered(tag: Tag) {
        if (screen == Screen.READ) { readTag(tag); return }
        val writeEpoch = epoch
        val current = lease ?: return
        if (!resumed || !busy.compareAndSet(false, true)) return
        val chipId = tag.id.joinToString("") { "%02x".format(it) }
        if (!flow.begin(chipId)) { busy.set(false); return }
        val overwriteConfirmed = overwritePermission.consume(current.job.id, current.token, screen != Screen.SINGLE)
        val writeOwner = api.userId
        val automaticWrite = screen == Screen.AUTO
        val reportKey = accountKey("reports")
        ui { if (resumed && epoch == writeEpoch) { message(t("writing")); showFeedback(WriteFeedback.WRITING, writeEpoch) } }
        executor.execute {
            try {
                api.verify()
                val fresh = api.jobs().find { it.id == current.job.id }
                if (fresh == null || !WriterSafety.sameAssignment(current.job, fresh)) throw WriterException("JOB_CONFLICT")
                if (!resumed || epoch != writeEpoch) throw WriterException("JOB_CONFLICT")
                if (automaticWrite) preparation(writeOwner).beginPhysical(current.job.id)
            } catch (e: Exception) {
                flow.pause(); busy.set(false); ui { if (resumed && epoch == writeEpoch) { reader(); message(error(e)); showFeedback(WriteFeedback.ERROR, writeEpoch, error(e)) } }; return@execute
            }
            val report = try {
                NfcWriter.writeAndRead(tag, current.job, overwriteConfirmed) { resumed && epoch == writeEpoch && System.currentTimeMillis() < current.expiresAt }
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
                preparation(writeOwner).completed(current.job.id)
                writeSession.completed++
                if (resumed && epoch == writeEpoch) {
                    flow.verified()
                    ui {
                        if (!resumed || epoch != writeEpoch) return@ui
                        message(t("remove"))
                        successGate.success(System.currentTimeMillis())
                        showFeedback(WriteFeedback.SUCCESS, writeEpoch)
                        // Android's ignore callback only fires once this physical tag has left the field.
                        val nfc = adapter
                        if (nfc == null || !nfc.isEnabled) { pauseWriting(); message(t("nfcOff")); return@ui }
                        val accepted = try { nfc.ignore(tag, 800, {
                            if (resumed && epoch == writeEpoch && flow.stage == WriterFlow.Stage.REMOVAL) {
                                successGate.removed()
                            }
                        }, handler) } catch (_: Exception) {
                            pauseWriting(); message(t("paused")); return@ui
                        }
                        // false also means the tag was already removed while the cloud report completed.
                        successGate.observeIgnoreResult(accepted)
                        awaitRemoval(writeEpoch)
                    }
                } else flow.pause()
            } catch (e: Exception) {
                flow.pause()
                writeSession.retryJobId = if (report.status == "verified") null else current.job.id
                ui { if (resumed && epoch == writeEpoch) { reader(); message(if (queue.isNotEmpty()) t("unsynced") else error(e)); render(); showFeedback(if (report.status == "verified") WriteFeedback.PENDING else WriteFeedback.ERROR, writeEpoch, error(e)) } }
            } finally { busy.set(false) }
        }
    }
    private fun awaitRemoval(expected: Int) {
        handler.postDelayed({
            if (!resumed || expected != epoch || flow.stage != WriterFlow.Stage.REMOVAL) return@postDelayed
            if (successGate.advance(System.currentTimeMillis()) && !busy.get()) {
                feedback.close(); flow.removed(); lease = null
                if (flow.readyForNext) arm(null) else reload()
            } else awaitRemoval(expected)
        }, 100)
    }
    private fun persistQueue() {
        check(prefs().edit().putString(accountKey("reports"), JSONArray(queue.map { reportJson(it) }).toString()).commit()) { "LOCAL_SAVE_FAILED" }
    }
    private fun restoreQueue() {
        writeSession.reset()
        lease = null
        queue.clear()
        val array = JSONArray(prefs().getString(accountKey("reports"), "[]"))
        for (i in 0 until array.length()) {
            val r = array.getJSONObject(i)
            queue.add(parseReport(r))
        }
        pendingBulk = OperatorPolicy.restorePending { prefs().getString(bulkKey(), null) }
    }
    private fun sync() {
        if (queue.none { Provisioning.canSync(it) }) return
        val authoritative = api.jobs()
        for (report in queue.toList()) {
            if (!Provisioning.canSync(report)) continue
            val job = authoritative.find { it.id == report.jobId }
            if (job == null || !Provisioning.matches(report, job) || Provisioning.superseded(report, job)) continue
            try {
                api.report(report)
                queue.remove(report)
                try { persistQueue() } catch (e: Exception) { queue.add(report); throw e }
                if (report.status == "verified") preparation().completed(report.jobId) else preparation().failedPhysical(report.jobId)
            }
            catch (e: ApiException) {
                if (e.code !in listOf("LEASE_EXPIRED", "LEASE_CONFLICT", "VERSION_CONFLICT", "JOB_CONFLICT", "JOB_INELIGIBLE")) throw e
            }
        }
    }
    private val autoSync = object : Runnable {
        override fun run() {
            if (resumed && api.token.isNotBlank() && queue.isNotEmpty() && !busy.get()) work {
                val before = queue.size; sync()
                if (before != queue.size) ui { if (queue.isEmpty()) feedback.close(); statusMessage = if (queue.isEmpty()) t("paused") else t("unsynced"); render() }
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
                showFeedback(WriteFeedback.ERROR, detail = t("expired"))
            }
            handler.postDelayed(this, 1000)
        }
    }
    private fun reviewQueue() {
        val report = queue.firstOrNull() ?: return
        AlertDialog.Builder(this).setTitle(t("review")).setMessage("${t(if (Provisioning.canSync(report)) "stale" else "legacyPending")}\n\n${report.visitorUrl}\n${t("version")}: ${report.version} · Protocol ${report.protocolVersion}")
            .setNegativeButton(t("cancel"), null).setNeutralButton(t("retry")) { _, _ -> work { sync(); ui { render() } } }
            .setPositiveButton(t("discard")) { _, _ -> work {
                queue.remove(report); persistQueue(); ui { render() }
            } }.show()
    }
    private fun reviewHistoricalBulk() {
        val body = pendingBulk ?: return
        if (!OperatorPolicy.requiresReview(body.optString("operation"))) return
        val rows = body.optJSONArray("cards") ?: JSONArray()
        val names = (0 until rows.length()).joinToString(", ") { rows.optJSONObject(it)?.optString("label").orEmpty() }
        AlertDialog.Builder(this).setTitle(t("reviewHistoricalBulk"))
            .setMessage("${t("historicalBulkDetail")}\n\n${body.optString("requestKey")}\n$names")
            .setNegativeButton(t("cancel"), null)
            .setPositiveButton(t("discardHistoricalBulk")) { _, _ ->
                if (pendingBulk !== body) return@setPositiveButton
                pendingBulk = OperatorPolicy.discardHistorical(body) { prefs().edit().remove(bulkKey()).commit() }
                if (pendingBulk != null) { message(t("saveFailed")); return@setPositiveButton }
                reload()
            }.show()
    }
    private fun bulkPreview(operation: String) {
        if (!OperatorPolicy.canSubmit(operation)) return
        if (checked.isEmpty()) { message(t("selectCard")); return }
        if (pendingBulk != null) {
            if (OperatorPolicy.requiresReview(pendingBulk!!.optString("operation"))) reviewHistoricalBulk() else message(t("retryOperation"))
            return
        }
        val ids = checked.toList()
        work {
            val body = JSONObject().put("action", "bulkPreview").put("tagIds", JSONArray(ids)).put("operation", operation)
            val groups = api.admin(body).getJSONArray("groups")
            ui { confirmGroup(groups, 0, operation) }
        }
    }
    private fun confirmGroup(groups: JSONArray, index: Int, operation: String) {
        if (!OperatorPolicy.canSubmit(operation)) return
        if (index >= groups.length()) { checked.clear(); reload(); return }
        val group = groups.getJSONObject(index); val rows = group.getJSONArray("cards")
        if (rows.length() == 0) { confirmGroup(groups, index + 1, operation); return }
        val kind = group.getString("kind")
        val description = t(if (kind == "recorded") "recordedConfirm" else "emptyConfirm")
        val detail = if (operation == "reset") t("resetConfirm") else ""
        val names = (0 until rows.length()).take(12).joinToString(", ") { rows.getJSONObject(it).optString("label") }
        AlertDialog.Builder(this).setTitle("${t(operation)} · ${rows.length()}").setMessage("$description\n$detail\n\n$names")
            .setNegativeButton(t("cancel")) { _, _ -> confirmGroup(groups, index + 1, operation) }
            .setPositiveButton(t("confirm")) { _, _ ->
                pendingBulk = JSONObject().put("action", "bulkApply").put("operation", operation).put("cards", rows).put("kind", kind).put("requestKey", UUID.randomUUID().toString())
                if (!prefs().edit().putString(bulkKey(), pendingBulk.toString()).commit()) { message(t("saveFailed")); return@setPositiveButton }
                applyPending { confirmGroup(groups, index + 1, operation) }
            }.show()
    }
    private fun applyPending(then: (() -> Unit)? = null) {
        val body = pendingBulk ?: return
        if (!OperatorPolicy.canSubmit(body.optString("operation"))) { reviewHistoricalBulk(); return }
        work {
            try { api.admin(body) }
            catch (e: ApiException) {
                if (e.code in listOf("VERSION_CONFLICT", "GROUP_CONFLICT", "TAG_NOT_FOUND", "CATEGORY_UNASSIGNED", "CATEGORY_NOT_FOUND")) { pendingBulk = null; prefs().edit().remove(bulkKey()).commit() }
                throw e
            }
            pendingBulk = null; prefs().edit().remove(bulkKey()).commit()
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
        return UUID.randomUUID().toString().also { check(prefs().edit().putString("device", it).commit()) { "LOCAL_SAVE_FAILED" } }
    }
    private fun date(value: String): String = runCatching {
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
    }.getOrDefault(value)
    private fun cardMetadata(card: Card): String = listOfNotNull(card.categoryCode?.let { copy.category(Category(card.categoryId.orEmpty(), "", it)) }, card.batchDate).joinToString(" · ").ifBlank { card.categoryName }
    private fun message(value: String) { statusMessage = value; if (::state.isInitialized) state.text = value }
    private fun ui(action: () -> Unit) { runOnUiThread { if (!isFinishing && !isDestroyed) action() } }
    private fun work(action: () -> Unit) {
        if (!busy.compareAndSet(false, true)) return
        val expected = epoch
        message(t("loading"))
        executor.execute {
            try { action() }
            catch (e: Exception) { if (epoch == expected) { flow.pause(); ui { if (epoch == expected && resumed) { reader(); message(error(e)); if (screen == Screen.AUTO && e.message in listOf("JOB_INELIGIBLE", "JOB_CONFLICT")) { writeSession.preparationBlocked = true; render() }; if (screen in listOf(Screen.AUTO, Screen.SINGLE)) showFeedback(WriteFeedback.ERROR, expected, error(e)) } } } }
            finally { busy.set(false) }
        }
    }
    private fun error(e: Exception): String = t(when(e.message) {
        "AUTH_REQUIRED", "OPERATOR_REQUIRED", "invalid_credentials" -> "auth"
        "CAPACITY" -> "capacity"; "READ_ONLY" -> "readOnly"; "FOREIGN_TAG" -> "foreign"
        "UNSUPPORTED" -> "unsupported"; "TAG_LOST" -> "lost"; "READBACK_MISMATCH", "INVALID_URL" -> "mismatch"
        "FORMATTED_RETRY" -> "formatted"; "LEASE_CONFLICT" -> "leased"; "CLIENT_UPGRADE_REQUIRED" -> "upgrade"
        "CATEGORY_UNASSIGNED" -> "emptyMove"
        "JOB_CONFLICT", "VERSION_CONFLICT", "GROUP_CONFLICT", "JOB_INELIGIBLE", "LEASE_EXPIRED" -> "conflict"
        "LOCAL_SAVE_FAILED" -> "saveFailed"; else -> "error"
    })
    override fun onResume() {
        super.onResume(); resumed = true; reader()
        if (::api.isInitialized && api.token.isNotBlank() && !busy.get()) {
            if (screen == Screen.READ) render() else reload()
        }
    }
    override fun onPause() {
        resumed = false; pauseWriting(); stopPlayback()
        inspectedCards = inspectedCards.map { if (it.state == "readCloud") it.copy(state = "readUnknown") else it }
        if (::api.isInitialized && api.token.isNotBlank()) executor.execute { releaseCurrent() }
        super.onPause()
    }
    override fun onDestroy() { handler.removeCallbacks(autoSync); handler.removeCallbacks(checkLease); executor.shutdown(); readExecutor.shutdown(); lookupExecutor.shutdown(); super.onDestroy() }
}

# Native NFC Writer

Operator-only Kotlin Android app. Uses Supabase password authentication followed by the server's `session` role check; credentials and access tokens are memory-only. Sign in again after restarting or token expiration. No visitor account is required.

## Build

Use JDK 17 and Android SDK platform 36 with build-tools 36.0.0 (Android Studio SDK Manager). The official Gradle wrapper is included; only its bootstrap JAR is checked in, not distributions or APKs.

Create ignored `local.properties` in this directory with:

```properties
sdk.dir=/absolute/path/to/Android/sdk
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-public-publishable-key
```

Only public configuration belongs in these fields. Never use a privileged database key. Public keys are packaged into the APK. Use separate local/test cloud projects and an explicitly authorized operator account.

也可通过构建进程环境变量 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 提供公开配置；`local.properties` 同名配置优先。APK 内包含公开项目网址和公开密钥，不包含运营账号或服务端密钥。安装后使用负责人已授权的运营邮箱和密码登录，服务端会再次检查运营角色。请先用虚构展签和测试芯片完成文末验收，不要把编译成功当作实体 NFC 已验证。

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The server must implement the frozen `admin-api` actions `session`, `jobs`, and `provision` documented in `docs/IMPLEMENTATION_COMPLETION.md`. Jobs and URLs are server-generated; URLs must match `https://voice.heisei.space/#/t/<opaque-token>` exactly. The app fetches all pages with offset/limit, 500 jobs per page, using the response total.

## Operation

Sign in, select a batch and pending/failed job, then select Write. The current label, version and exact URL remain visible. A successful write is followed by a fresh physical NDEF read, not cached discovery data. Only one URI record and exact equality can generate verified. Each attempt pauses automatically: remove the tag and explicitly select/arm the next job. Skip does not mark a job verified. NFC settings, pause and retry are available. The app never reads UID for binding and never locks a tag read-only.

Unformatted NDEF-capable chips are formatted, reported as failed `FORMATTED_RETRY`, then must be removed and re-presented for write/read verification. Unsupported, read-only, capacity, lost-tag and readback errors are failed reports. Network failure retains a durable unsent report. Reports are partitioned by server and operator ID, restored after login, reconciled against current server versions and resent idempotently. A stale/missing job blocks synchronization rather than rewriting its version or falsely confirming. Resolve Stale Reports shows changed/missing jobs and requires explicit confirmation to discard only those obsolete reports; the new server job still requires a physical write/read. Clearing app data removes unsent reports and requires physical re-verification; login credentials are not persisted. Android backup is disabled.

## Real-Chip Acceptance (Required)

When another operator has already verified the same job/version/URL, an offline failed report is superseded. Synchronization skips that failed report and continues other reports without converting it to verified. Resolve Stale Reports explicitly confirms discarding these superseded failures as well as changed/missing jobs. Backgrounding always cancels arming, including an in-flight server check: return to the app and select Write again.

1. Use fictional jobs on an authorized test backend. Confirm anonymous/non-operator login cannot access jobs.
2. Write one chip, remove it, re-scan independently and compare the full URL with the same server job. Confirm a second phone opens the intended visitor page.
3. Repeat with minimum-capacity, read-only, unsupported and unformatted chips; test tag removal mid-write and mismatch. None may become verified without exact physical readback.
4. Disable NFC, pause/background the app, skip and retry. No unintended tag may be written while paused.
5. Disconnect networking after physical verification; restart, login as the same operator, sync, and confirm only the original job/version is accepted. Test an expired session and stale server job version.
6. Record physical chip model/capacity, Android phone/OS and iPhone compatibility. A JVM test or emulator is not evidence of physical NFC completion.

NDEF and reader mode follow [Android Ndef](https://developer.android.com/reference/android/nfc/tech/Ndef) and [NfcAdapter](https://developer.android.com/reference/android/nfc/NfcAdapter) APIs. No production resource changes are performed by the app build.

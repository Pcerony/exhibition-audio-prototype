# Native NFC Writer

运营人员专用 Kotlin Android 应用，界面支持日语（默认）、中文和英语。参观者不需要安装或创建账号。V3 必须配合录音后分类 V3 后端，不能单独安装后继续使用旧服务器写卡协议。

## V3 工作界面

- 卡片管理：按四个固定分类、待分类、录音日期（YYYY-MM-DD）、新旧编号/库存号/昵称及录音状态筛选；按录音提交时间或编号排序；分页浏览和短期授权试听。分类名称按界面语言显示，不提供创建或改名。
- 单张写卡：不选择分类，选定一张卡再写；已完成的卡必须明确确认重新写卡。普通写入拒绝覆盖已有其他内容；“覆盖已有内容”必须再次确认，仅授权当前手动租约下一次触碰，自动模式永不继承该权限。
- 自动写卡：独立统一空卡池模式，无分类选择或分类前置条件。只领取启用、未录音、待写的卡；服务端租约保护多人写卡。写入、重新物理读回、服务端确认后，必须收到标签已移开的系统回调才能领取下一张。
- 批量编辑：当前页勾选，移动/重置/删除都经服务端版本预检；未录音和已有录音分别确认。只能纠正已录音卡分类，空卡不能移动分类。纠正沿原录音日期换号但不改 URL 和录音；重置清空当前分类/日期/正式号，恢复库存号，旧号不复用，URL 不变。
- 全局设置：账号、退出登录、语言与 NFC 系统设置。刷新保留在卡片列表，不再把技术同步命令平铺为日常按钮。

会话仅保存 refresh token，由 Android Keystore AES-GCM 加密保护，不保存密码；访问令牌只在内存中。启动恢复并检查运营角色，刷新请求串行化；角色撤销/退出登录会停止 NFC。语言选择持久化。会话恢复、Keystore 和实体 NFC 必须另外真机验证，单元测试不替代硬件测试。

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
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

服务器须实现 `docs/API_CONTRACT.md` V3 及 `docs/superpowers/specs/2026-10-16-post-recording-classification.md`。jobs/leaseJob/nextJob/provision 使用 protocolVersion 3；nextJob 仅发送设备 ID，不发送分类。任务与完整 URL 由服务端产生；URL 必须精确匹配 `https://voice.heisei.space/#/t/<opaque-token>`。任务分页每页 500，卡片每页 50。APK 版本为 3.0.0 / versionCode 5。

空卡显示稳定库存号 U000001；成功录音后显示正式号（例如 261017-A003）和录音日期批次，写卡日期不是录音批次。固定分类为 A 美食、B 旅行、C 相遇、D 其他回忆。历史录音的旧编号与未分类状态按服务端返回保留，不强制套用新分类。

## Operation

登录后默认进入卡片管理，该页面不启用 NFC 写入。进入单张或自动写卡页面并明确开始后才启用写卡模式；自动模式使用统一未录音卡池，与管理页面筛选无关。普通暂停、切后台、锁屏、返回前台均不自动恢复写入。写入前重新校验角色、任务版本、卡片版本和分类/录音资格；服务端报告还会重新校验租约。物理动作与云端之间不能做跨系统原子事务，因此并发变更后的芯片必须按提示重新核查，不能把报告冲突当作成功。

只有一次 URI 记录且与服务端任务完全相等才产生核验成功报告。读回使用重新连接后的 `Ndef.ndefMessage`，不是发现时缓存。UID 仅在本机内存中防止重复触碰，不上传、不用于身份绑定或日志；应用从不将芯片锁为只读。

未格式化芯片先格式化，再移开重试，不能报告成功。只读、容量不足、离场、不同网址和读回不符均暂停并说明原因。断网结果按项目/运营账号分区持久保存，联网自动尝试同步；租约到期、卡片变化或任务缺失不会伪造成功。待同步结果显示原始完整网址供人工核查，明确确认后才丢弃。自动同步完成仍须手动继续，不直接领取下一张。清除应用数据会清除待同步报告，必须重新实体核验；系统备份已禁用。

批量操作在首次执行前保存幂等请求（固定 requestKey 和预检版本），网络不确定时重试原请求，不自动生成新请求。结果对象不是音频备份。

升级保留原账号/项目分区中的待同步结果。旧 V2 报告（包括缺少协议字段的旧记录）保持原协议，不会改成 V3 自动重发，也不会自动升级为成功。界面明确标识旧结果及原网址；负责人核对实体芯片后才可明确丢弃，并按需重新取得 V3 手动租约写入及物理核验。旧待处理结果仍阻止新写入，不能静默清除以绕过核查。旧批量空卡移动重试由服务端 CATEGORY_UNASSIGNED 拒绝，不会预分类。

## Real-Chip Acceptance (Required)

另一个运营者已核验相同任务时，旧失败报告不会被升级成成功；其他可同步报告继续发送，过时结果由运营者核查后显式丢弃。返回前台需要重新开始，包括切后台时仍在等待的网络请求。

1. Use fictional jobs on an authorized test backend. Confirm anonymous/non-operator login cannot access jobs.
2. Write one chip, remove it, re-scan independently and compare the full URL with the same server job. Confirm a second phone opens the intended visitor page.
3. Repeat with minimum-capacity, read-only, unsupported and unformatted chips; test tag removal mid-write and mismatch. None may become verified without exact physical readback.
4. Disable NFC, pause/background the app, skip and retry. No unintended tag may be written while paused.
5. Disconnect networking after physical verification; restart, login as the same operator, sync, and confirm only the original job/version is accepted. Test an expired session and stale server job version.
6. Record physical chip model/capacity, Android phone/OS and iPhone compatibility. A JVM test or emulator is not evidence of physical NFC completion.
7. 重启应用验证会话恢复；撤销角色、主动退出、过期刷新、断网恢复均需停止 NFC。切换账号后不得发送前一账号的待同步结果。
8. 同一芯片一直贴着时只能完成一张；两台写卡设备同时领取不能获得同一任务。写卡过程中移动、删除或绑定录音必须产生冲突/暂停，不能误报新任务完成。
9. 分别检查三语、小屏布局、50 张分页、试听中切后台、分组删除取消/重试，以及确认后卡片版本变化的拒绝行为。

NDEF and reader mode follow [Android Ndef](https://developer.android.com/reference/android/nfc/tech/Ndef) and [NfcAdapter](https://developer.android.com/reference/android/nfc/NfcAdapter) APIs. No production resource changes are performed by the app build.

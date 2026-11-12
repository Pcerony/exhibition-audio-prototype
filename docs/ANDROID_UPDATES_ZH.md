# 安卓应用内更新

## 工作人员

旧版若显示「手机未能通过校验」，请从 [正式发布页](https://github.com/Pcerony/exhibition-audio-prototype/releases/latest) 下载新版，直接覆盖安装，不要卸载旧版。之后打开应用时会检查新版本，也可以在菜单点「检查更新」。

从 3.6.1 起：发现新版 → 用浏览器下载 → 在手机的「下载」中打开 APK → 安卓系统确认安装。按系统提示操作；遇到签名冲突或设备安全策略拦截时，不要卸载旧版或关闭安全保护。覆盖更新保留账号及本地数据。

写卡必须先停止，待上传的写卡结果必须先同步。没有网络、下载失败或校验失败，都可以继续使用现有版本。更新不会清空芯片或删除云端录音。

目前是启动检查和手动检查，不是后台常驻推送；应用没打开时不会弹通知。原生逻辑变化必须安装 APK，不能仅下载网页数据替代。网页和云端配置更新不需要重装安卓。

## 发布人员

版本清单：`https://voice.heisei.space/updates/android.json`。APK 来自同一仓库 GitHub Release 的固定版本链接。不要覆盖已经发布的同版本 APK，修复应增加 versionCode。

交付给工作人员的版本一律发布为正式更新，不使用预发布标签或仅提供本地测试包。上传 APK 后必须更新线上清单；验证清单和下载文件一致后再通知工作人员从应用内升级。

1. 增加 `app/build.gradle.kts` 的 versionCode/versionName，执行单测、assembleDebug、lintDebug；构建时注入公开 Supabase 配置。
2. 检查 APK 包名、签名及 public 配置。必须与安装版使用同一签名；不能让临时机器重新生成 debug 签名。生产签名迁移需要单独计划。
3. 上传不可变 Release APK，确认 GitHub 返回的 digest 和 size 与本地一致。
4. 执行：`node scripts/publish-android-feed.mjs /absolute/path/voice-writer-v3.6.1.apk apps/tag-writer-android/app/build/outputs/apk/debug/output-metadata.json v3.6.1 public/updates/notes-3.6.1.json`。脚本只有核对远端摘要后才生成清单。
5. 提交 `public/updates/android.json` 并部署 Pages；读取线上清单确认，再通知现场升级。若暂缓发布，保留现有清单，不让清单指向尚未上传的文件。

Pages 部署核对 APK 的大小及 SHA-256 后，提供带版本文件名的 `/updates/download/` 浏览器下载，以及兼容旧客户端的 SHA-256 路径镜像。清单仍保留原 GitHub URL。新版客户端只检查清单，不再自行读取或安装 APK，也不再申请安装权限；Android 系统负责安装时的验证。

## 验收边界

JVM 测试覆盖清单、版本和浏览器下载地址；发布检查覆盖大小、摘要和 APK 签名。Android 构建和 lint 不代替实体安装测试。真机需确认浏览器下载、同签名覆盖安装、账号保留、写卡与待同步保护。

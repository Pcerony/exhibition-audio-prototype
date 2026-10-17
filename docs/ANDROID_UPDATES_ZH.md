# 安卓应用内更新

## 工作人员

首次需手动安装 3.3.0，直接覆盖安装，不要卸载旧版。之后打开应用时会检查新版本，也可以在菜单点“检查更新”。更新说明支持日、中、英三语。

发现新版后：下载更新 → 安装更新 → 安卓系统确认安装。首次会要求允许“此应用安装未知应用”；打开后返回应用，再点安装。账号及本地数据保留。只有更新本应用需要此权限，不是让其他网站安装软件。

写卡必须先停止，待上传的写卡结果必须先同步。没有网络、下载失败或校验失败，都可以继续使用现有版本。更新不会清空芯片或删除云端录音。

目前是启动检查和手动检查，不是后台常驻推送；应用没打开时不会弹通知。原生逻辑变化必须安装 APK，不能仅下载网页数据替代。网页和云端配置更新不需要重装安卓。

## 发布人员

版本清单：`https://voice.heisei.space/updates/android.json`。APK 来自同一仓库 GitHub Release 的固定版本链接。不要覆盖已经发布的同版本 APK，修复应增加 versionCode。

1. 增加 `app/build.gradle.kts` 的 versionCode/versionName，执行单测、assembleDebug、lintDebug；构建时注入公开 Supabase 配置。
2. 检查 APK 包名、签名及 public 配置。必须与安装版使用同一签名；不能让临时机器重新生成 debug 签名。生产签名迁移需要单独计划。
3. 上传不可变 Release APK，确认 GitHub 返回的 digest 和 size 与本地一致。
4. 执行：`node scripts/publish-android-feed.mjs /absolute/path/voice-writer-v3.3.0-candidate.apk apps/tag-writer-android/app/build/outputs/apk/debug/output-metadata.json v3.3.0-rc1 public/updates/notes-3.3.0.json`。脚本只有核对远端摘要后才生成清单。
5. 提交 `public/updates/android.json` 并部署 Pages；读取线上清单确认，再通知现场升级。若暂缓发布，保留现有清单，不让清单指向尚未上传的文件。

客户端限制 HTTPS 来源、重定向域名、文件体积、时间；下载后和安装前核对 SHA256、包名、版本号和当前安装包的签名。只通过 FileProvider 分享 updates 缓存目录，不分享账号、音频或任意文件。

## 验收边界

JVM 测试覆盖清单/版本/来源/体积/摘要；Android 构建和 lint 不能代替实体安装测试。需实际手机验证：旧版覆盖升级后账号保留、未知来源授权后返回安装、离线重试、写卡与待同步保护，以及下一次更高版本的应用内更新闭环。尚无连接的测试设备，不能声称上述实测已完成。

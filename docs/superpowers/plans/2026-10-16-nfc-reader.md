# NFC Reader Implementation Plan

**Goal:** 安卓新增三语只读NFC检查，联网确认展览卡片及试听。
**Architecture:** 独立物理读取适配器、纯Kotlin内容识别、现有认证任务及公开卡片查询；读取不进入写卡状态机。
**Tech Stack:** Kotlin、Android NFC ReaderMode、JUnit、现有Supabase接口。

## 执行顺序

- [x] 新增 `NfcInspectionTest.kt`：48位token完整网址匹配、空记录/二进制/外部文本、显示截断与多链接去重；运行 `./gradlew testDebugUnitTest` 观察缺失实现失败。
- [x] 新增 `NfcInspection.kt` 内容模型与分类，`NfcReader.kt` 仅连接/读取/关闭，不调用写卡和格式化；复跑测试。
- [x] `Api.kt` 封装 `inspect(url)`：只请求配置云端，完整网址匹配jobs，public-tag返回录音；不存在与网络失败分开。
- [x] `MainActivity.kt` 增加READ入口，跳过分类加载依赖，先展示实体内容后查云端；页面代次/账号校验；独立重读/重试，保留待同步回报。
- [x] `Copy.kt` 加三语，更新版本号及中文指南；增加三语键测试。测试命令带配置与JDK/SDK，避免生成空配置APK。
- [x] 跑Android全部测试/构建/lint、前端测试/普通及Pages构建；检查签名与配置。21项JVM、83项前端、2项Node+14项Deno通过。
- [ ] 发布独立试用APK。真机读卡由用户验收，不伪称自动化已覆盖。

验收：空NDEF与未格式化区分；外部URL不打开；同域非卡片URL不冒充有效；断网保留物理读数；跨页面/后台结果不回填；只读路径无格式化/写入/租约/回报调用。

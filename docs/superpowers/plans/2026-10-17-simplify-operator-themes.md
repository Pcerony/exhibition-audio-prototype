# 工作人员主题管理简化实施计划

**Goal:** 工作人员无需手动分类，固定主题仅随参观者选择自动生成编号。
**Architecture:** 只收窄网页和Android管理UI，不改变domain/API/database，保留历史数据和导出元数据。
**Tech Stack:** React/TypeScript、Kotlin、Vitest/JUnit。

- [ ] 网页：CloudAdminPage及测试/CSS，先红后绿移除分类nav/filter/move和无效状态，保持日期/搜索/状态、CSV、重置删除和审核。UI不调用categories接口；不动共享存储接口。
- [ ] Android：MainActivity及纯策略测试移除categoryPicker/categoryAPI调用和移动入口，列表始终categoryId空；保留卡号/日期。旧pendingBulk move禁止自动发送，显式核查丢弃不误发。版本3.1.1/code7，完整JVM/assemble/lint。
- [ ] 集成：独立规范/质量审查，npm test -- --run、npm run test:backend、普通/Pages构建，配置APK --rerun-tasks；网页手机桌面合成截图，无真实录音。
- [ ] 文档/发布：更新中文指南/API UI边界/状态与验证；PR合并、Pages状态确认，发布3.1.1调试APK和SHA256，不改云数据或NFC网址。

# 项目路线图

阶段按数据正确性依赖排序。云端闭环先完成；三个客户端在 API 契约冻结后可分工并行，不要求每个阶段都拆成独立 Git 仓库。

2026-10-01：阶段0–3的可独立实现部分已完成，云端合成数据测试与 Android 构建通过。当前处于阶段4前的试点准备；真实运营身份、保留策略、芯片与手机验收仍未完成。详见 [验证记录](VERIFICATION.md)，以下清单保留为验收范围，不将代码完成等同于生产验收。

## 阶段 0：系统基线与契约

- 本文档组、根 `AGENTS.md`、API DTO/错误码和状态契约完成。
- 决定 Supabase 区域、管理员邮箱/认证方式、音频大小上限、保存期限；建立 dev/staging 与 production 隔离。
- 本地 adapter 仅用于开发/测试；生产 cloud adapter 不允许静默降级。

## 阶段 1：云端录音闭环（第一开发优先级）

- Supabase schema/migrations、private Storage、RLS、安全 Edge Functions、原子绑定/重置、审核日志。
- 参观者 Web 替换本地 repository：标签查询、麦克风录制、签名上传、finalize claim、短期播放 URL。
- 第一阶段验收必须跨两台设备；并发提交只能绑定一个对象。
- 管理员认证最小保护要与后台首次连真实数据同一阶段上线，不能把云端管理 UI 暴露为匿名写接口。

## 阶段 2：云端运营后台

- 认证登录、批量 CSV 导入/导出、搜索/筛选、录音试听、重置/禁用、审计、失败恢复。
- 管理后台生成 visitor URLs 与写卡 batches，为 Android provisioning API 提供稳定数据源。

## 阶段 3：Android NFC 写卡应用

- 原生 Kotlin：登录、领取批次、展示编号/待写计数、单枚 NDEF URI 写入、读回核验、失败重试/跳过、进度同步。
- 先用一枚已购实体芯片在支持 NFC 的 Android 设备试点，确认 URI NDEF、容量、锁定/只读提示和现场操作姿势。
- 不在 app 内维护第二份标签真相；后台 API 是批次和状态权威。

## 阶段 4：试点与上线

- iPhone Safari 和 Android Chrome 真机录音/播放，iOS 音频 MIME/时长/后台中断测试。
- 逐枚标签写后读回；从两个访客设备验证先绑定/后播放/重置。
- 负载/并发、权限、备份与删除演练；确认展期结束留存策略、展厅 Wi-Fi/蜂窝信号和音量体验。
- 通过运营方验收后再将访客网址用于实体展览。

## 并行 Agent 工作波次

1. **契约波次（先串行完成）**：集成负责人冻结 schema、API DTO、错误码、配置和验收例。
2. **实现波次（可并行）**：Backend Agent 负责 `supabase/**`；Visitor Agent 负责访客页和 repository adapter；Android Agent 负责 `apps/tag-writer-android/**` 的 NFC/UI，不改服务端契约；Integration Agent 维护测试/部署与跨端验收。后台 Agent 可与访客 UI 并行，但只在自己的页面模块工作。
3. **集成波次**：单一集成负责人合并 migrations、契约类型和各客户端，执行跨端测试，禁止同时部署未验收的生产改动。

任务拆分以 [`../AGENTS.md`](../AGENTS.md) 的文件所有权和本 API 文档为准。

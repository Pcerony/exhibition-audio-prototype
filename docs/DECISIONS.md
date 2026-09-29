# 架构决策记录

决策状态：`Accepted` 已采纳；`Proposed` 暂定且需项目负责人确认；`Superseded` 已被后续决定取代。

## ADR-0001：每枚 NFC 标签预写唯一 URL

**状态：Accepted**

使用同一个网站域名，但每枚标签的 NDEF URI 带独立服务端 token。手机系统打开 URI，网页由 token 查询具体标签。Android 写卡工具在运营准备阶段批量写入和读回验证。音频在云端，不写进 NFC；访客录音之后无需再次碰芯片。

**拒绝：** 所有标签都写同一母 URL，再要求网页识别 NFC UID。网页通常只收到 URL，无法通过 iPhone Safari 的页面脚本获知触碰的实体标签；相同 URL 因而不能区分标签。录音后再由另一台 Android 写卡会增加现场交接且不满足一次碰触。

## ADR-0002：云端数据由 Supabase 托管

**状态：Accepted for MVP**

采用 Supabase Postgres、私有 Storage、Auth、Edge Functions。原因：一套托管服务覆盖关系型标签/绑定状态、对象存储、管理身份和边缘 API；RLS 与数据库唯一约束可共同守住访问和“一个标签一段录音”。生产 region、项目账号和账单由项目负责人确认后创建。

私有 Storage 与 RLS 是方案的一部分，不把音频放 public bucket，也不将 service-role key 暴露到任何客户端。参照 [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) 和 [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)。

## ADR-0003：先完成云端访客闭环，再接管理与写卡端

**状态：Accepted**

第一优先级是云端上传、原子绑定、跨设备播放；运营端完成最小认证保护并为写卡端提供稳定的 URL/batch API。Android 与后台 UI 可在 API 契约冻结后并行实现，但实体 NFC 写卡集成依赖批次接口。

## ADR-0004：现有 React/Vite 原型先渐进升级

**状态：Accepted**

不在第一个云端版本同时重写前端或移动全部目录。先为现有 `TagRepository` 添加云端适配器；后续若 admin/visitor 独立发布节奏有实际需要，再单独迁移为多 app workspace。

## ADR-0005：公开播放使用短期签名 URL

**状态：Accepted**

标签 token 允许查询该标签及申请其已绑定音频播放，但不是重置、覆盖或运营权限。每次播放由服务端从 private bucket 生成短期 URL；永久公共对象 URL 不可接受。

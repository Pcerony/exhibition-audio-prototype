# 阶段一：云端录音闭环

## 当前落地状态（2026-10-01）

- 东京 Supabase 项目的核心 schema 和私有 `recordings` bucket 已部署；公开查询、上传初始化、原子绑定和签名播放 Edge Functions 已部署。
- 已对公开查询和上传初始化做云端 smoke test，并删除临时测试展签；尚未进行真实音频上传、并发 claim、播放和 iPhone 真机验收。
- 录音端现在会在 60 秒自动停止；上传签名有效期与数据库会话时长已对齐，终止性 claim 失败会尝试清理候选对象。对“上传后关闭页面、从未 finalize”的对象仍缺少定期回收任务。
- 参观者前端已实现 Supabase adapter；GitHub Pages 工作流读取仓库 Actions Variables。管理后台的云端认证/批量建签仍未完成。
- 正式收集参观者声音前，仍需确定录音保留/删除期限，并最终确认 MIME、字节上限和限频策略。

## 目标

用 Supabase 替代生产流程中的 localStorage/IndexedDB：未绑定标签可录音并上传，一枚标签只原子绑定一段音频，其他设备可经标签网址收听。运营管理至少有身份认证，不能把现有公开原型后台直接连接到生产数据库。

## 依赖和开始条件

- 本阶段使用 `docs/PROJECT.md`、`ARCHITECTURE.md`、`API_CONTRACT.md`、`SECURITY_PRIVACY.md` 为验收依据。
- Supabase 项目由项目负责人创建。东京区域已确认；音频保留期限、最大上传字节数和允许 MIME 仍须在真实访客录制前定稿。开发可先使用 Supabase CLI 本地栈或隔离 dev 项目。
- 不把现有本地数据自动当正式录音迁移；先用明确的虚构测试标签和音频验证。

## 实施顺序

### 1. 固定 DTO 与 repository 接口

- 将 API 请求/响应、错误码、Tag/Recording 状态放入共享类型，后端函数与客户端使用同一 schema。
- 调整 `TagRepository` 的播放边界：访客按 `tagToken` 获取短期播放 URL；运营者按 `recordingId` 在认证请求下获取短期 URL。
- 创建 fake/mock API 实现契约测试；生产配置缺少 Supabase 时必须显示配置错误/不可用状态，不可静默回退到 local browser data。

### 2. 建立云端 schema 与访问策略

建议 migration 管理下列概念：

- `tags`: UUID、展示编号、批次、随机 public token、`unbound|bound|disabled`、创建/状态时间。
- `recordings`: UUID、唯一 `tag_id`、Storage object path、可选 nickname、MIME、bytes、duration、created_at；`UNIQUE(tag_id)`。
- `upload_sessions`: UUID、tag_id、唯一随机 object path、状态、过期时间、完成时间；用于限制 finalize 只能使用本服务创建的上传。
- `operator_profiles`/授权 metadata：仅允许运营者角色；不可由访客自行更新角色。
- `audit_log`: operator、动作、目标 tag、时间和 request ID，不保存音频或签名 URL。

迁移必须从空数据库可重放。所有 exposed tables 开 RLS；测试 anon、authenticated 非 operator、operator 三类权限。Storage bucket 为 private，上传不能覆盖已有对象。

### 3. 实现受控上传和原子绑定

按 API 契约实现公开查询、上传初始化、claim/finalize、访客播放 URL，以及 authenticated admin playback。签名 URL 只对服务端随机生成的候选 object path 有效。数据库原子函数检查标签仍 `unbound`、upload session 有效、候选对象已存在，然后一次性写 recording 并变更 tag 状态。

测试两个并行 finalize 只有一个成功；另一个收到 `already-bound` 并清理候选对象。测试签名过期、标签预先绑定、对象不存在、MIME/大小超限、上传中断和清理失败的恢复。

### 4. 接入访客页面和后台

- 增加 Supabase adapter 并以配置显式选择；修改 App 的 repository 注入，不在模块加载时无条件创建 browser-only repository。
- 访客保留现有录音/重录/可选昵称交互；submit 依次初始化上传、上传 Blob、finalize；只有 finalize 返回 `claimed` 才显示成功。
- 访客播放按 token 获取短期 URL，`audio.src` 直接播放，不把 private audio Blob 永久缓存进 IndexedDB。
- 管理页先增加登录/登出与受保护路由，再接批量列表、导入/导出、试听、重置/停用。后台请求不允许匿名操作。
- GitHub Pages 构建只含 `VITE_SUPABASE_URL` 和公开 anon key；service role 仅在 Supabase server secrets。

### 5. 集成验收

- 从干净 dev database 重放 migrations，部署 functions，验证 RLS。
- 测试完整链路：后台创建标签 -> 参观者设备 A 上传 -> 后台看见绑定 -> 访客设备 B 播放 -> 后台重置 -> 标签恢复 unbound。
- 同标签并发两次 claim；确认只有一个音频有效，失败音频不可播放且最终清理。
- 真机测试 iPhone Safari 和 Android Chrome，记录实际 MediaRecorder MIME、授权、录音、网络中断恢复结果。
- 检查 `dist/` 不含 service role/token pepper/数据库 secret；检查 production build 不会落到 localStorage adapter。

## 并行分配

先由 Integration Lead 确认 API DTO、repository 接口和 SQL 函数签名。之后可并行：

- **Backend Agent**：`supabase/migrations/**`、`supabase/functions/**`、`supabase/tests/**`；仅更新 API 契约需请求 Integration Lead 同步审核。
- **Visitor Agent**：`src/features/visitor/**`、访客相关测试；通过约定的 `TagRepository` 调用，不改 backend function 名称或 schema。
- **Admin Agent**：`src/features/admin/**`、admin tests；Auth 和 repository API 依赖先固定，不直接查 Storage bucket。
- **Android Agent**：尚不属于阶段一阻塞项；可做隔离的 NFC NDEF spike，但不生成新的 URL 规则，不接 production provisioning API。
- **Integration Lead**：共享 domain/repository、环境配置、CI/deploy、契约测试、跨端集成。一个共享接口文件只能有一个 owner。

## 阶段完成定义

云端数据库和 Storage 已部署在受控项目；跨设备闭环、RLS、并发 claim、失败回收及重置均通过自动/真机测试；公开网站不包含服务端密钥；参观者与运营者看到的状态来自同一云端记录，而不是 browser storage。

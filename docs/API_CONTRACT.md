# 跨端 API 契约

此文档是访客 Web、管理 Web、Android 写卡端和 Supabase 服务实现的共同边界。先按本契约实现 mock 和类型，再改动服务端 API 时同时更新本文件、契约测试与调用方。以下是 MVP 语义契约；具体 Supabase Function URL 可采用 `/functions/v1/<function-name>`，不得让各客户端自行拼表或直连 privileged tables。

## 通用

- 基础域名由环境配置；JSON UTF-8；时间均为 ISO-8601 UTC。
- UUID 仅用于内部记录。访客路径中的 `<token>` 是服务端生成的至少 128-bit 随机、不透明、URL-safe token。
- 成功响应只返回 DTO 所需字段；错误使用 `{ "code": "TAG_NOT_FOUND", "message": "...", "requestId": "..." }`。客户端根据稳定 `code` 本地化，不展示内部异常。
- 管理 API 使用 Supabase Auth bearer JWT，并由服务端验证 operator allowlist/role。访客 API 不要求登录但须速率限制。
- 所有音频上传路径由服务端生成；客户端不能指定 bucket/key，也不能向数据库直接写绑定状态。

## 访客 API

### 查询标签

`GET /public/tags/{token}`

返回：

```json
{
  "label": "展签 01",
  "status": "unbound",
  "recording": null
}
```

`status` 为 `unbound | bound | disabled`。绑定时 `recording` 包含 `nickname`（可空）、`durationSeconds`、`createdAt`；不在初次响应放长期公开对象 URL。未知 token 返回 `404 TAG_NOT_FOUND`；disabled 返回不可录制/播放的说明。

### 建立上传会话

`POST /public/tags/{token}/uploads`

请求：`{ "mimeType": "audio/mp4", "sizeBytes": 123456 }`。服务端校验标签当前未绑定、允许的 MIME 与字节上限，创建随机对象路径和短期上传会话，返回 `{ "uploadId": "...", "uploadUrl": "...", "uploadToken": "...", "expiresAt": "..." }`。签名上传只允许创建指定对象，不允许 upsert/覆盖。

### 上传后原子绑定

`POST /public/uploads/{uploadId}/claim`

Authorization 带该上传会话的单次 upload token。请求：`{ "nickname": "可选昵称", "durationSeconds": 42 }`。服务端校验会话未过期、对象存在、真实尺寸/MIME、时长与标签状态，然后在单个原子数据库操作中绑定录音。

返回 `{ "status": "claimed", "recording": { ... } }` 或 `{ "status": "already-bound", "recording": { ... } }`。后者绝不覆盖，服务端异步/可靠地清理未获胜候选对象。其他状态错误不能让客户端误报成功。

### 播放链接

`POST /public/tags/{token}/playback-url` 返回 `{ "url": "...", "expiresAt": "..." }`。仅对 `bound` 标签签发短期链接；音频对象始终保存在 private bucket。短期链接不是永久分享地址。

## 运营管理 API

- `POST /admin/tag-batches`：CSV/JSON 批量校验并创建标签和 provisioning job；支持幂等 request key。每项返回 `tagId,label,batch,visitorUrl,provisioningStatus`。只在授权运营 session 中返回 visitor URL。
- `GET /admin/tags`：分页、搜索、状态筛选；包含标签、绑定录音元数据和 provisioning 状态，不把 signed audio URLs 缓存在列表中。
- `POST /admin/tags/{tagId}/reset`：必须认证并二次确认；原子解除绑定并写审计，可靠删除旧音频。重复请求幂等。
- `POST /admin/tags/{tagId}/disable` / `.../enable`：认证操作并写审计。disabled 标签的访客 API 不签上传或播放 URL。
- `POST /admin/tags/{tagId}/provisioned`：Android 写卡端在 NDEF 写后读回成功，提交校验过的 job/version；服务端将该 job 标为 verified。写卡失败记录错误码，不误报成功。
- `POST /admin/recordings/{recordingId}/playback-url`：已认证运营者为后台试听申请短期 URL；校验 operator 权限，不绕过私有存储。

## Android provisioning API

- Android app 先用运营者 Supabase Auth 会话登录，再领取待写列表：`GET /writer/jobs?batchId=...`。每一项包含 job/version、展示编号、完整 `visitorUrl` 和期望状态。
- App 写入 NDEF URI 后，从芯片读回 URI；只有与服务端 `visitorUrl` 完全匹配才调用 provisioning success。写卡 app 不自行生成 token/URL，也不读取 NFC UID 作为绑定 id。
- 同一任务重复上报必须幂等；过期 job、已核销任务需要服务端返回明确冲突，避免覆盖错误标签。
- 批量工作支持暂停/继续；一次物理写卡错误不能阻塞其他标签。

## 并发和契约测试

- 针对同一个未绑定 token 同时发起两个 finalize，恰有一方 `claimed`，另一方 `already-bound`；`recordings.tag_id` 唯一约束是最后一道防线。
- 两个不同 token 可并行绑定。
- 已绑定、disabled、过期 upload session、伪造 object path、无效 MIME/超限对象均不能改变标签状态。
- 访客 token 无法调用 admin/writer/reset/list API；未登录和非 operator 用户均失败。

## 客户端 Repository 边界

当前原型只有 `getAudio(recordingId)`，无法安全表达“访客按标签 token 播放”与“运营者按 recording ID 试听”的不同授权。云端迁移前先调整共享接口，至少暴露 `getVisitorPlaybackUrl(tagToken)` 和 `getAdminPlaybackUrl(recordingId)`；本地 adapter 可从各自元数据映射到 Blob URL。访客 UI、后台 UI 不得直接导入 Supabase SDK 并各自实现授权逻辑。

# 跨端 API 契约

实际端点为 Supabase `/functions/v1/<name>`。UTF-8 JSON、UTC ISO 时间。错误以稳定 `code` 本地化，不显示内部异常。访客 token 是服务端随机不透明身份，不能用 NFC UID 或序号代替。

## 访客 API

- `GET public-tag?token=...` → `{label,status,recording}`；状态 unbound/bound/disabled。recording 含 nickname、durationSeconds、createdAt，不含永久 URL。未知 token 返回404。
- `POST public-upload-init` 请求 `{token,mimeType,sizeBytes}` → `{uploadId,path,storageToken,claimToken,expiresAt}`。路径由服务器生成，上传不得 upsert。标签必须未绑定且启用；校验 MIME/大小、每标签8次/小时限频。签名生成后会话延长121分钟，覆盖2小时上传凭证。
- 客户端使用 storageToken 上传指定 private recordings 对象；没有写表权限。
- `POST public-upload-claim`：`x-upload-token` 为 claimToken，请求 `{uploadId,nickname,durationSeconds}`。时长1–60秒，昵称可空。校验候选尺寸/MIME并原子绑定。成功 `{status:'claimed',recordingId,createdAt}`；并发输家409 ALREADY_BOUND。重置后旧会话不可补绑。
- `POST public-playback-url` 请求 `{token}` → `{url,expiresInSeconds:120}`，仅启用的 bound 标签可用。链接过期可重新申请；private bucket 不提供公共对象 URL。

失败候选永久失效并持久排队，等待签名上传凭证到期后删除，避免对象重建。获胜对象不能被候选回收删除；reset/claim 使用一致 tag-first 锁顺序。

## 管理与写卡 API

`POST admin-api`，JSON 必含 `action`。Bearer 为 Supabase Auth access token，apikey 为公开项目 key。服务端 getUser 验证身份，再查 operator_profiles（operator/admin）。匿名、已登录非运营者均拒绝；客户端不得直连 privileged tables/RPC。

- `session` → `{userId,role}`。
- `list` 请求 `search,status,offset,limit` → `{tags,total}`。tag 为 `id,token,label,batch,status,createdAt,recording,provisioning`；recording 为 `id,nickname,duration,mimeType,createdAt`。
- `createBatch` 请求 UUID `requestKey`、`rows:[{label,batch}]`（1–500）→ `{tags}`。全批原子提交，规范化编号唯一；同 key/内容重放返回首次响应快照，不同内容冲突。token/网址由服务器生成。
- `reset` 请求 `tagId` → `{ok:true}`，原子解除绑定、失效旧会话、写审计、排队回收。重复安全；UI 二次确认，访客无此权限。
- `setEnabled` 请求 `tagId,enabled` → `{ok:true}`，启用后按录音恢复 bound/unbound。
- `playback` 请求 `recordingId` → `{url,expiresInSeconds:120}`，不返回内部存储路径。
- `jobs` 请求可选 `batch,status,offset,limit` → `{jobs,total}`，单页最多500，按不可变 ID 排序；调用方取全量应分页，并发新增/删除或筛选成员变化时刷新。
- `provision` 请求 `jobId,version,visitorUrl,status`（verified/failed）、可选 `errorCode` → `{ok:true}`。完整 URL/版本匹配；verified 重报幂等，不接受 failed 降级。
- `audit` → `{entries}` 最近100项，字段 `id,action,operatorId,tagId,createdAt`。
- `maintenance` → `{removed,pending}`，认证运营者处理回收队列。

job 为 `{id,tagId,label,batch,visitorUrl,version,status,errorCode}`。服务端网址固定 `https://voice.heisei.space/#/t/<token>`，Android 不生成 token。

独立 `POST maintenance` worker 要求 `x-maintenance-secret` 匹配 Edge MAINTENANCE_SECRET，无配置失败关闭。定时任务秘密存 Vault，不给客户端。

## Android 与 Repository

Android 使用同一 Auth/管理接口，NDEF 写后物理读回 URI 完全一致才上报 verified；失败、只读、容量不足或未格式化不得误报。断网结果保留账号/服务端作用域队列；过时任务和已 verified 的旧 failed 报告可显式丢弃，不阻塞其他报告，更不能自动转为 verified。

访客 TagRepository 按 token 获取播放链接，运营 AdminRepository 按认证 recordingId 获取播放链接。类型见 `src/storage/adminRepository.ts`，UI 不各自拼表/直读 Storage。

## 必测

同标签并发仅一方绑定；重复 claim 不删赢家；禁用/过期/重置旧会话不可绑定；匿名/非运营管理拒绝；公共对象读取拒绝；回收失败保留队列。接口变更须同步后端、调用方、测试和本文档。

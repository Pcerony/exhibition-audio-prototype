# 跨端 API 契约

## 按需写卡（开发中，旧nextJob语义不变）

认证prepareWrite请求{deviceId:string,requestKey:UUID,protocolVersion:3}，返回{job,leaseToken,expiresAt}，expiresAt同leaseJob为UTC毫秒Z格式。服务端按运营者/设备串行，当前有效自动租约优先，其次可租的pending统一空卡，再无则创建一张并租约。requestKey幂等绑定任务，网络重放不多创建；已完成/录音/禁用/删除/版本改变不复活原请求，JOB_INELIGIBLE/JOB_CONFLICT。旧nextJob仍只领取现有池不自动创建。失败卡显式leaseJob重试，后台批量开卡仍可备用。Android按账号/服务端持久保存请求key，错误重试原key，实体写后读回及provision确认不变。详见[设计](superpowers/specs/2026-10-17-on-demand-writing-design.md)。

## 可选语音转写（接口与调度已启用，真实录音识别待验收）

- public-upload-claim新增`transcriptionConsent?:boolean`，缺省false，非boolean拒绝400 REQUEST_INVALID；成功原子claim后只为true同意录音插入pending任务。历史/旧Android/未同意录音不自动传Groq。失败/无密钥不影响录音保存；此功能不改变V3卡号或协议。
- RecordingInfo新增`transcriptionConsent?:boolean,transcript?:string|null`；public-tag只返回同意标记及已发布且ready的transcript纯文本，未审核/隐藏/处理/失败任务不返回正文。匿名不能直读转写表或编辑/执行任务。disabled/deleted/reset卡不返回文字。
- `getTranscription`请求recordingId -> `{configured:boolean,consented:boolean,transcription:Transcription|null}`，仅认证运营者。Transcription=`{recordingId,status:'pending'|'processing'|'ready'|'failed',text:string|null,published:boolean,version:number,errorCode:string|null,updatedAt:string}`。无密钥configured=false，不能假装已接通提供商。
- `retryTranscription`请求`{recordingId,version:number}` -> `{ok:true}`；只允许录音已同意且对应版本，未配置Groq返回503 TRANSCRIPTION_NOT_CONFIGURED，不改状态。任务新代/撤销旧租约、隐藏旧正文、重排队；人工重试最多受服务端频率限制，旧worker不能回写。
- `saveTranscription`请求`{recordingId,version:number,text:string,published:boolean}` -> `{ok:true}`；纯文字最多10000字符，发布不允许空白文本。乐观版本检查、撤销在途租约，status置ready并增加version，published=false为草稿/隐藏；不得覆盖新录音。保存不向AI发请求。缺录音404 RECORDING_NOT_FOUND，无同意409 TRANSCRIPTION_CONSENT_REQUIRED，无任务404 TRANSCRIPTION_NOT_FOUND，版本冲突409 VERSION_CONFLICT。
- 现有AdminRepository新增required方法`getTranscription(recordingId)`,`retryTranscription(recordingId,version)`,`saveTranscription(recordingId,version,text,published)`，返回按上述定义。后台list DTO本轮不携带草稿，按需get避免列表泄漏。
- 私有POST transcription-worker使用x-maintenance-secret=MAINTENANCE_SECRET，缺/错401，无Groq密钥503 TRANSCRIPTION_NOT_CONFIGURED且不领任务。每次最多1条；服务端私有对象下载后调用固定Groq端点及whisper-large-v3-turbo；密钥仅Edge Secrets。worker完成条件包括recording仍为有效tag当前录音、同意、租约token/version匹配。重置/删除级联取消，禁用期间不处理/不公开；编辑/重试撤销旧结果。API错误只返回稳定码，不含供应商原始错误或正文。
- Groq原语言转写，非翻译；新文本默认不公开。审核发布只影响文本不影响音频。默认不开启自动cron，待GROQ_API_KEY配置后集成负责人执行独立Vault-backed调度脚本，不能在代码中写入密钥或自动开通付费。

## 录音后分类 V3（当前契约）

- 固定分类A/B/C/D，固定UUID依次`00000000-0000-4000-8000-000000000001`至`...0004`，名称美食/旅行/相遇/其他回忆。`categories`只返回这四项，nextNumber兼容字段不用于预分配；createCategory/renameCategory拒绝CATEGORIES_FIXED。
- `createCards`请求`{count,requestKey,protocolVersion:3}`，不传categoryId。全批幂等创建未分类空卡及稳定随机网址。内部库存号U000001全局不复用。
- tag/job DTO保留旧字段并增加`inventoryLabel:string,categoryCode:'A'|'B'|'C'|'D'|null,batchDate:'YYYY-MM-DD'|null,serialNumber:string|null`，categoryId为固定分类UUID或null。label优先正式serialNumber，否则历史label/库存号。batch兼容为日期字符串或历史批次，不能再当分类名。历史录音保留旧编号与元数据，不强制分入四类。空卡categoryId/categoryCode/batchDate/serialNumber均null。
- `list`在已有查询上增加`batchDate?:'YYYY-MM-DD',uncategorized?:boolean`；categoryId仅四固定UUID。搜索包括正式号、库存号、旧编号历史；空类不得因inner join丢失。批次取成功录音时间的Asia/Tokyo日期，非开卡/写卡日期。
- `public-upload-claim`新增必填`categoryCode:'A'|'B'|'C'|'D'`，无效/缺失为CATEGORY_REQUIRED或CATEGORY_INVALID，400。与location/录音绑定同事务分配日期和日内分类序号，只有claimed才分号。日内分类从001起，超过999自然扩展。重复请求/并发输家不多分配、不改赢家。公开public-tag返回上述编号/分类字段，不返回存储路径。
- reset/bulk reset清空当前分类/批次/正式号、恢复库存标识，永久保留旧号供检索且不复用。move仅用于已录音卡纠正分类，targetCategoryId取四固定UUID，沿原batchDate分配目标类新号；空卡move返回CATEGORY_UNASSIGNED。旧录音未有batchDate则由原recording.createdAt的Tokyo日期确定。删除/重置/移动仍版本检查、分组确认与审计。
- jobs/leaseJob/nextJob/provision均protocolVersion:3；旧协议HTTP426 CLIENT_UPGRADE_REQUIRED。jobs不按创建分类过滤；nextJob只需要deviceId，不带categoryId，从统一可写空卡池领取，幂等/租约/人工重写规则与V2一致。releaseJob仍按租约身份执行。
- 前端`NewRecording.categoryCode`可选以兼容本地旧测试，但生产claim必须提供。`AdminRepository.createCards(count,requestKey)`改签名，createCategory/renameCategory保留兼容类型但UI不再提供入口；date filter和DTO新增为可选字段，读取null容错。公开网址/token/音频私有/原子一对一不变。

## 分类管理 V2（历史契约，被V3同名规则取代）

以下扩展与旧接口分开发布：后端、网页和Android同时完成回归前不得将本节视为生产已部署。完整字段及操作参见 [冻结实施计划](superpowers/plans/2026-10-15-operator-experience.md)。访客URL与音频授权规则不变。

- `categories` 返回 `{categories:[{id,name,code,nextNumber}]}`；`createCategory` 请求 `{name,requestKey}` 返回 `{category}`；`renameCategory` 请求 `{categoryId,name}`。
- `createCards` 请求 `{categoryId,count,requestKey}` 返回 `{tags}`。服务器分配号，1–500；重试不重复创建。
- `list` 增加 `categoryId,sort`（recorded_desc/recorded_asc/number）。tag增加categoryId/version，batch兼容分类名，recording.createdAt是用户提交时间。稳定排序、空录音最后。
- `bulkPreview` 请求 `{tagIds,operation,targetCategoryId?}` 返回 `{groups:[{kind,cards:[{id,version,label}],recordingCount}]}`。kind为empty/recorded，operation为move/delete/reset。
- `bulkApply` 请求 `{operation,cards,kind,targetCategoryId?,requestKey}`。服务器重验版本和分组；每组独立原子提交，重放幂等。删除与重置均失效旧上传，删除软标记并使URL失效。移动改编号而不改ID/token/URL/录音，旧编号永久预留。
- `jobs` 增加categoryId与protocolVersion=2，job增加categoryId和recordingStatus。`leaseJob` 请求 `{jobId,deviceId,protocolVersion:2}`；`nextJob` 请求 `{categoryId,deviceId,protocolVersion:2}`；成功返回 `{job,leaseToken,expiresAt}`，无符合条件任务返回 `{job:null}`。expiresAt为UTC ISO时间。
- `releaseJob` 请求 `{jobId,leaseToken}`；V2 `provision` 附protocolVersion和leaseToken，校验服务器租约、版本、URL与当前有效性。旧写卡协议升级保护不能仅靠客户端。

所有新请求仍由运营JWT及allowlist授权。设备ID是随机安装标识，不是NFC UID。租约token不得进入日志/CSV。账号退出或切后台停止NFC；物理读回不能由网络响应代替。

兼容性要求：`leaseJob` / `nextJob` 的 `expiresAt` 统一为毫秒精度、以 `Z` 结尾的UTC ISO字符串，例如 `2026-10-16T01:11:25.656Z`。不要直接透传PostgreSQL的 `+00:00` 时间格式，旧Android的 `Instant.parse` 无法解析。转换不能延长服务端租约；缺失或不可解析时返回503，不能放行写卡。

V2补充：job还有tagVersion、leased、leaseExpiresAt、writtenAt（核验成功的写卡时间，可空）。租约10分钟，同设备模糊响应重试返回当前租约；列表绝不返回leaseToken。同租约verified只接受原请求重放，不接受failed改写；显式单张重写取得新手动租约后可记录本次失败。稳定错误为CATEGORY_NOT_FOUND、CATEGORY_NAME_EXISTS、VERSION_CONFLICT、GROUP_CONFLICT、LEASE_CONFLICT、LEASE_EXPIRED、JOB_INELIGIBLE及HTTP426 CLIENT_UPGRADE_REQUIRED。

实际端点为 Supabase `/functions/v1/<name>`。UTF-8 JSON、UTC ISO 时间。错误以稳定 `code` 本地化，不显示内部异常。访客 token 是服务端随机不透明身份，不能用 NFC UID 或序号代替。

## 访客 API

录音新增可选 `location`：省略/null 表示跳过；`{source:'pin',lat:number,lng:number}` 为用户确认的地图点，纬度-90..90、经度-180..180且必须为有限数字；`{source:'place',placeId:string}` 为搜索地点，仅保存最多300字符的非空place ID，不永久存储Google返回的地名/地址/坐标。claim请求携带该字段，与录音同事务保存，公共/认证管理录音查询返回；旧客户端仍可省略。重置随录音移除地点，不提供匿名单独修改接口。

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

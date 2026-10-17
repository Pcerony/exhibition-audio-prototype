# 跨端 API 契约

## 二维码录音补实体卡（Android 3.4）

仅认证 admin-api 的 operator/admin 可用，不扩展共享 staff 角色。所有操作不创建 tag/token/录音，不改变原 URL，不进入普通写卡池。

- `qrCards {search?,status?,batchDate?,sort?,offset?,limit?}` → `{tags,total}`，仅 QR 身份，tag DTO 增 `attachment:job|null`，保留 entryChannel。按编号/库存号/id搜索，日本录音日筛选；sort=recorded_desc/recorded_asc/number，默认最新，limit≤50。
- `qrJobs {offset?,limit?}` → `{jobs,total}`，专用补卡 Job DTO 增 `jobKind:'qr'`；不含租约 token/芯片 hash。
- `prepareQrAttachment {tagId,expectedVersion,deviceId,protocolVersion:3}` → `{job,leaseToken,expiresAt}`。仅有效且已录音的 QR 身份；每 tag 一任务，绑定原 recording ID/tag version。同账号/设备有效租约重放返回原任务；其他有效租约冲突，过期只恢复原任务。已完成、禁用、删除或录音改变拒绝。
- `beginQrAttachment {jobId,leaseToken,chipHash,protocolVersion:3}` → `{ok:true}`，写前登记64位小写hex的SHA256 UID。只接受第一次登记的芯片，同hash不能给其他记录补卡；不是公开身份，不写日志/审计。
- `provisionQrAttachment {jobId,leaseToken,version,visitorUrl,status:'verified'|'failed',errorCode?,protocolVersion:3}` → `{ok:true}`。原录音、完整URL、版本/租约校验；verified须已登记芯片。原报告可跨期限幂等重放，不允许failed降级或另开实体卡。
- `releaseQrAttachment {jobId,leaseToken}` → `{ok:true}`，原租约操作者释放，保留任务和芯片登记。

错误沿用 REQUEST_INVALID/JOB_CONFLICT/JOB_INELIGIBLE/LEASE_CONFLICT/LEASE_EXPIRED/CLIENT_UPGRADE_REQUIRED；新增 CHIP_CONFLICT（409，换芯片或已分配其他记录）。Android本地报告增jobKind，旧记录默认nfc，发送时只用于选择端点，不传到旧provision。

专用私有租约收据保留原账号/任务及已登记芯片的写前授权，因此首次结果迟到、甚至同任务已被另一设备续租后，原操作者仍可提交原有效 verified 报告；写前 begin 始终要求当前未过期租约。过期不会授权新的物理写入。晚到 failed 不覆盖另一设备的新尝试，也不能降级 verified。客户端看到完全匹配任务/网址/版本已 verified 时，持久移除被成功结果取代的 QR failed 报告，避免堵塞后续补卡。

## 语言提示与工作人员重新转写

新录音`public-upload-claim`可带`transcriptionLanguage`（ja/zh/en/ko/es/fr/de/it/pt/ru/vi/th/id/ar/hi/auto），省略按ja；界面语言zh-CN/zh-TW均映射zh。工作人员`staff-api`新增`retryTranscription`，字段`recordingId/memberId/version/languageHint`；名单身份、同意、当前绑定、版本、每条一分钟限频及provider配置均在服务端验证。list的`transcription`增`languageHint`。重试保留旧文作参考、立即取消公开、撤销旧lease、版本+1并重新排队；相同版本并发仅一条成功，处理中不可重复。审计动作为`staff_retry_transcription`，保留署名/时间/语言，不记正文。新结果仍需人工确认。仅转写原语言，不调用翻译接口；既有20条不批量重跑。

## 现场工作人员网站（候选）

`POST staff-api` 验证 Supabase JWT 和 `operator_profiles` 的 staff/operator/admin 角色；staff 仍不能访问 admin-api。共用一个受限 staff 登录账号，成员名单通过 session 返回，选中 memberId 本机按项目/账号记住。姓名是自报身份，不代替认证账号。

工作人员网页仅接受普通账号名`staff`，映射为已确认的内部Auth标识`staff-portal@staff.invalid`，无需收件邮箱。密码仍由Auth验证；网页仅接受`staff`角色会话，误配置为高权限角色时拒绝登录并退出。服务端API为兼容负责人直接核验继续允许operator/admin调用，但共享账号不得具有这两种角色。没有邮件找回流程，密码由负责人通过受控Auth管理重设。

- `session` -> `{userId,role,members:[{id,name}]}`。
- `list` 接受 `{tagId?,search?,reviewState?:'all'|'unreviewed'|'approved'|'empty',categoryCode?:'A'|'B'|'C'|'D',batchDate?,offset?,limit?}`，limit 1–50，search最多120字符。录音提交时间倒序、空卡最后、ID次排序；类别/状态/日期过滤与检索均在分页之前。返回 `{cards,total}`。卡片含 categoryCode（未分类历史卡为null），只含 id/label/inventoryLabel/status/createdAt/categoryCode/recording，不含 token、provisioning、Storage path。录音含 id/duration/createdAt/location/transcriptionConsent/transcription/pieceAssignment/latestReview。专用认证 DTO 的 transcription 含 status/text/published/version/updatedAt，不含供应商错误。既有 admin list/CSV 继续不含正文，匿名接口只读 ready 且 published 的文字。
- `save` 接受 `{recordingId,memberId,version,text,published}`。纯文本最多10000字符；published=true 必须非空，保存 ready、递增 version、撤销 AI 租约。需有效当前启用录音、转写同意、既有任务和版本。保存草稿隐藏文本；确认发布后访客可见。并发旧版本返回409 VERSION_CONFLICT，禁用/删除/重置返回404 RECORDING_NOT_FOUND。更新和审计同事务。
- `playback` 接受 `{recordingId,memberId}`，短期签名网址120秒；`activity` 接受 `{recordingId,memberId,event:'location_viewed'}`；`history` 接受 `{tagId}` 返回该卡最近100项 `{id,action,memberName,createdAt}`。
- 审计保留认证账号、名单ID/姓名快照、当前录音ID、动作和服务时间；不得包含文本/音频/访客token/签名URL。成员ID由服务器名册验证，客户端不得传审计姓名或时间。
- `staff_action(uuid,jsonb)` 仅 service_role 可执行；staff 角色不获得任何表直读、旧管理RPC或写卡权限。成员名册私有表启用RLS，不允许公开注册自行获得staff角色。
- AI成功写回新文字也递增转写version，以拒绝AI完成前打开的旧编辑器。旧finish RPC的内部实现不对service_role开放，调用路径仍为原有 `finish_transcription` 名称/参数。

## 工作人员界面边界（2026-10-17）

固定A/B/C/D是参观者主题，空卡无主题，提交录音后自动赋号。完整后台和Android不提供分类编辑；工作人员审核列表可按A/B/C/D筛选，但不能创建/改名/移动分类。工作人员的`staff-api list`支持`categoryCode?:'A'|'B'|'C'|'D'`，过滤发生在检索和分页之前。为兼容历史客户端，本轮不删除categoryId/uncategorized/move等服务端契约、不迁移或清除数据。Android历史待处理move必须人工核查丢弃，禁止新版重发。

## 按需写卡（已部署，旧nextJob语义不变）

认证prepareWrite请求{deviceId:string,requestKey:UUID,protocolVersion:3}，返回{job,leaseToken,expiresAt}，expiresAt同leaseJob为UTC毫秒Z格式。服务端按运营者/设备串行，当前有效自动租约优先（等待当前任务锁而非跳过），其次可租的pending统一空卡，再无则创建一张并租约。requestKey幂等绑定任务和卡片/任务版本，网络重放不多创建；已完成/录音/禁用/删除/版本改变不复活原请求，JOB_INELIGIBLE/JOB_CONFLICT。同key过期仅可续原任务，有其他当前自动任务返回LEASE_CONFLICT；跨账号/设备key冲突返回REQUEST_KEY_CONFLICT，协议错误426 CLIENT_UPGRADE_REQUIRED。新key不领取仍有旧lease_token的未知过期任务。旧nextJob仍只领取现有池不自动创建。失败卡显式leaseJob重试，后台批量开卡仍可备用。Android按账号/服务端持久保存请求key，收到任务后原子替换为含原版本/网址的持久指派，物理开始前另存不确定标记；错误重试原任务，实体写后读回及provision确认不变。详见[设计](superpowers/specs/2026-10-17-on-demand-writing-design.md)。

## 可选语音转写（接口与调度已启用，真实录音识别待验收）

- public-upload-claim新增`transcriptionConsent?:boolean`，缺省false，非boolean拒绝400 REQUEST_INVALID；成功原子claim后只为true同意录音插入pending任务。历史/旧Android/未同意录音不自动传Groq。失败/无密钥不影响录音保存；此功能不改变V3卡号或协议。
- RecordingInfo新增`transcriptionConsent?:boolean,transcript?:string|null`；public-tag只返回同意标记及已发布且ready的transcript纯文本，未审核/隐藏/处理/失败任务不返回正文。匿名不能直读转写表或编辑/执行任务。disabled/deleted/reset卡不返回文字。
- `getTranscription`请求recordingId -> `{configured:boolean,consented:boolean,transcription:Transcription|null}`，仅认证运营者。Transcription=`{recordingId,status:'pending'|'processing'|'ready'|'failed',text:string|null,published:boolean,version:number,errorCode:string|null,updatedAt:string}`。无密钥configured=false，不能假装已接通提供商。
- `retryTranscription`请求`{recordingId,version:number}` -> `{ok:true}`；只允许录音已同意且对应版本，未配置Groq返回503 TRANSCRIPTION_NOT_CONFIGURED，不改状态。任务新代/撤销旧租约、隐藏旧正文、重排队；人工重试最多受服务端频率限制，旧worker不能回写。
- `saveTranscription`请求`{recordingId,version:number,text:string,published:boolean}` -> `{ok:true}`；纯文字最多10000字符，发布不允许空白文本。乐观版本检查、撤销在途租约，status置ready并增加version，published=false为草稿/隐藏；不得覆盖新录音。保存不向AI发请求。缺录音404 RECORDING_NOT_FOUND，无同意409 TRANSCRIPTION_CONSENT_REQUIRED，无任务404 TRANSCRIPTION_NOT_FOUND，版本冲突409 VERSION_CONFLICT。
- 现有AdminRepository新增required方法`getTranscription(recordingId)`,`retryTranscription(recordingId,version)`,`saveTranscription(recordingId,version,text,published)`，返回按上述定义。后台list DTO本轮不携带草稿，按需get避免列表泄漏。
- 私有POST transcription-worker使用x-maintenance-secret=MAINTENANCE_SECRET，缺/错401，无Groq密钥503 TRANSCRIPTION_NOT_CONFIGURED且不领任务。每次最多1条；服务端私有对象下载后调用固定Groq端点及whisper-large-v3-turbo；密钥仅Edge Secrets。worker完成条件包括recording仍为有效tag当前录音、同意、租约token/version匹配。重置/删除级联取消，禁用期间不处理/不公开；编辑/重试撤销旧结果。API错误只返回稳定码，不含供应商原始错误或正文。
- Groq原语言转写，非翻译；新文本默认不公开。审核发布只影响文本不影响音频。默认不开启自动cron，待GROQ_API_KEY配置后集成负责人执行独立Vault-backed调度脚本，不能在代码中写入密钥或自动开通付费。

### 运营列表转写状态摘要

- 认证`admin-api`的`list`可接收`transcriptionState?:'not_consented'|'pending'|'processing'|'draft'|'published'|'failed'`。筛选在服务端全量集合上先执行，再计数、排序和分页；所有现有搜索、录音状态、日期和排序行为保持不变。筛选只匹配已有录音，不匹配空卡。
- Admin列表中的录音可包含`transcriptionSummary:{consented:boolean,status:'pending'|'processing'|'ready'|'failed'|null,published:boolean}`。无同意时展示未同意；已同意但任务缺失或pending时筛为待处理；ready且未发布为草稿待审核；ready且published为已发布。列表只取状态字段，不带正文、错误码或供应商错误。
- `admin-api`认证后将列表请求路由到数据库`admin_list(operator,body)`；该函数先校验运营者与筛选参数，再在服务端筛选、计数和分页，并只授权给Edge Function使用的`service_role`执行。Edge Function按当前页批量补充地点与最小转写摘要，不能把转写正文、对象路径或内部错误带入列表DTO或CSV。
- 列表摘要仅由认证运营API返回；访客`public-tag`响应不变。既有单条`getTranscription`仍是唯一的运营端正文读取入口；CSV字段不新增转写状态或正文。非法筛选值返回HTTP 400 `REQUEST_INVALID`。

## 73 块拼装板归属（v13，功能分支待发布）

- `public-upload-claim`可选接收瞬时`mapPoint:{lat:number,lng:number}`。它只用于成功claim后的本次分类；缺失、无效、图外或边界不确定均不得使录音/地点提交失败。Place搜索结果坐标不得落库、写日志或回传；已存`location`仍遵循下方访客地点契约（Place ID 或用户确认的pin坐标）。音频/地点claim成功后，服务端以版本`fukuoka-road-73-v13`尝试保存自动板块摘要；计算或RPC失败时claim仍返回`claimed`，assignment保持待处理/待核对。自动输出只表示地点推算线索，不证明实体卡的实际摆放位置。
- 新迁移`202610170004_map_piece_assignment.sql`在录音claim时创建assignment：无地点为`not_applicable`，有地点为`pending`。成功分类的状态为`assigned`、`needs_review`或`outside_map`，字段含`pieceCode|null`、`source:'automatic'|'manual'|null`、`mapVersion|null`、`version`和`updatedAt`。仅73个合法编号可赋值；边界25米内、无效点、图外不伪造明确板号。相同自动写入幂等，任何自动结果都不能覆盖人工修正。
- `admin-api`认证`list`增加`pieceCode?:string`，由数据库在全量筛选后、count和分页前应用；仅接受地图73个编号。每条录音可带最小`pieceAssignment`摘要，不包含`mapPoint`、Places坐标/地址/名称或转写正文。已有认证后台地点读取字段契约不因本功能扩大。CSV字段保持不变。
- `admin-api`认证操作员可调用`setPieceAssignment`，请求`{recordingId,expectedVersion,state,pieceCode,mapVersion}`。`state`为`assigned|needs_review|outside_map`；assigned必须带合法`pieceCode`，另外两种必须为null；`mapVersion`必须为`fukuoka-road-73-v13`。服务端以JWT验证出的操作者身份调用原子RPC，忽略请求中伪造身份字段；版本不匹配返回409 `VERSION_CONFLICT`，录音/展签不存在返回404 `RECORDING_NOT_FOUND`，无权限返回403 `OPERATOR_REQUIRED`。写入和`map_piece_override`审计旧值/新值/操作者/时间同事务完成。
- 后台将地图估算与人工修正明确区分；点击73块之一可筛选列表，选择列表记录可高亮其板号。窄屏地图在自身区域横向查看。2026-10-17迁移和Edge已按负责人上线授权部署，前端随staff PR发布；生产备份/恢复、迁移演练及验收见验证记录。

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

### 仅二维码备用入口

- 独立二维码子页面位于`#/staff/qr`（工作人员入口）和`#/admin/qr`（运营入口），不新增网站、账号或角色模型。staff页面只有二维码生成工作流，不需要选择审核署名，也不调用标签列表、试听、审计读取或写卡作业接口。
- `createQrEntry`请求`{requestKey:UUID}`。staff页面通过现有staff-api会话请求，运营页面继续通过既有admin-api运营会话请求。响应`{id,label,entryChannel:'qr',visitorUrl}`；服务端原子创建一条尚未绑定录音、没有NFC provisioning job的标签身份，并返回现有访客流程使用的稳定不透明token网址。
- 页面在当前浏览器标签页的`sessionStorage`按用户保存已签发条目；新条目自动选中，工作人员可点历史条目重新显示对应二维码。刷新后仍可回看，staff/operator任一后台退出或认证失效时清除历史及当前/待重试请求key，避免后续登录恢复上个账号的二维码；列表仅属本标签页，不是服务端或跨设备历史，不新增API。
- requestKey按操作者和请求内容幂等：网络结果不确定时重试必须使用原key并取回原网址；新参与者只能由界面显式开始后生成新key。跨操作者或不同请求体重用返回`REQUEST_KEY_CONFLICT`。`qr_issue`审计与标签创建同事务提交。
- 标签`entryChannel`为`nfc`（历史/常规标签默认）或`qr`。二维码标签不进入Android的任何自动/手动写卡池；管理列表标记“仅二维码”，不能误示为待写卡。参观者扫码后由普通`#/t/<token>`路由进入原录音/收听流程。
- 将来是否把该同一网址补写到一枚NFC卡是独立后续流程，本接口不绑定实体卡、不改写既有URL，也不承诺现在可以安全补写。

job 为 `{id,tagId,label,batch,visitorUrl,version,status,errorCode}`。服务端网址固定 `https://voice.heisei.space/#/t/<token>`，Android 不生成 token。

独立 `POST maintenance` worker 要求 `x-maintenance-secret` 匹配 Edge MAINTENANCE_SECRET，无配置失败关闭。定时任务秘密存 Vault，不给客户端。

## Android 与 Repository

Android 使用同一 Auth/管理接口，NDEF 写后物理读回 URI 完全一致才上报 verified；失败、只读、容量不足或未格式化不得误报。断网结果保留账号/服务端作用域队列；过时任务和已 verified 的旧 failed 报告可显式丢弃，不阻塞其他报告，更不能自动转为 verified。

访客 TagRepository 按 token 获取播放链接，运营 AdminRepository 按认证 recordingId 获取播放链接。类型见 `src/storage/adminRepository.ts`，UI 不各自拼表/直读 Storage。

## 必测

同标签并发仅一方绑定；重复 claim 不删赢家；禁用/过期/重置旧会话不可绑定；匿名/非运营管理拒绝；公共对象读取拒绝；回收失败保留队列。接口变更须同步后端、调用方、测试和本文档。

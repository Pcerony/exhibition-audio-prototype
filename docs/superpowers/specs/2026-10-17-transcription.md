# Groq异步语音转写第一版

用户批准尝试Groq Whisper语音转文字，目标为低成本/免费额度试用，非实时字幕、非翻译。复用私有Supabase录音，异步服务端请求whisper-large-v3-turbo；不租GPU、不向网页/Android提供API密钥。仅处理新增录音明确勾选的可选AI转写，默认关闭；历史录音不自动发送。转写失败/未配置不影响录音绑定和编号。

转写以recording_id绑定并级联删除；数据库持久化队列、租约和乐观版本，worker超时后可重领，最多3次自动尝试/退避，人工重试可重新排队。HTTP429尊重Retry-After，不无限重试；缺少GROQ_API_KEY立即返回未配置且不消耗尝试次数。下载私有对象后由服务端上传Groq，超时/大小限制、纯文字结果长度限制、错误码白名单，禁止记录音频/转写正文/签名URL/秘密。并发worker只能领取一次；旧任务结果不能覆盖人工校对、重试或重置后的状态。

第一版默认不公开AI草稿。网页后台录音行增加文字入口，查看状态、校对/保存草稿、发布、隐藏和重试，保留原试听。公开网页只通过启用的已绑定tag取published且ready的text，折叠“查看文字”，标识AI转写可能有误。保存文本按纯文本呈现，不能执行HTML/Markdown指令。隐私政策增加Groq第三方处理/自愿选择/公开文本。

worker用既有MAINTENANCE_SECRET验证x-maintenance-secret；独立cron SQL复用既有Vault键但不改维护任务/不旋转密钥，默认每分钟一次，每次最多一个任务。配置脚本仅由集成负责人执行；缺少Groq密钥时不启动cron，不升级付费、不创建账单。真实识别质量须配置密钥后用自愿录音验证，不用mock结果冒充。

跨端契约见API_CONTRACT.md。backend子任务只拥有supabase及隔离验证脚本；admin子任务只features/admin；父Agent独占domain/storage/visitor/i18n/docs/package/deploy。Android本轮不改，旧客户端未提交转写同意则不转写。

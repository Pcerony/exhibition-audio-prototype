# 语音转写实施计划

**目标：** 接入可选、异步、后台审核后公开的Groq转写，缺密钥安全等待。

**架构：** 新表队列独立于录音成功，claim同事务记录同意/排队；租约RPC控制worker和编辑版本。HTTP API仅服务端下载/转写，公端只读已发布文本。

**技术：** Supabase Postgres/Edge/pg_cron、Groq Whisper、React/TypeScript、Deno/PGlite/Vitest。

- [x] 父Agent冻结契约与domain/storage类型；TDD覆盖同意标记、公开文本映射和后台动作。
- [x] 后端实现migration、claim可选同意、私有worker/提供商客户端、审核RPC/授权、并发与失效/重试/未配置测试。不运行生产，不发送真实录音。
- [x] 后台文字编辑/状态/发布隐藏重试及未配置提示，动作不影响原录音。测试先红后绿。
- [x] 父Agent参观者可选同意、五语政策、已发布文本折叠阅读、preview不发AI请求；完整测试与桌面/手机截图。
- [ ] 独立审查，生产migration dry-run/保护快照/回滚预演，部署后合成验证不触发Groq。仅在密钥存在且得到配置授权时启动cron和真实识别测试；否则交付配置步骤且明确未真实转写。

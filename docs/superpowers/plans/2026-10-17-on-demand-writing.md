# 按需写卡实施计划

**Goal:** 写卡端按需创建并连续写入，明显提示每个阶段且不重复开卡。
**Architecture:** prepareWrite认证事务复用/创建并租约；Android持久幂等请求和应用内反馈状态机；现有provision核验与结果队列不变。
**Tech Stack:** Supabase Postgres/Edge、Kotlin原生Activity、JUnit、Deno、Vitest。

- [ ] 后端：supabase/migrations/202610170002_on_demand_writing.sql扩展prepareWrite，admin-api允许新动作并统一UTC期限；supabase/tests新增PGlite和真实PG并发验证，先红后绿；旧接口保持兼容。父Agent所有跨端接口已在设计冻结。
- [ ] Android：Api.kt提供prepareWrite(deviceId,requestKey)，新增持久请求/反馈纯状态测试；MainActivity连续模式接入，新增独立WriteFeedbackDialog/反馈助手，Copy中日英与VIBRATE权限；失败/读回/移除/暂停/账号隔离保持保护。先跑新增失败测试再实现。版本3.1.0/code6。
- [ ] 集成负责人：检查两端契约，独立规范与代码质量审查；运行npm test -- --run、npm run build、GITHUB_PAGES=true npm run build、后端全测与Android testDebugUnitTest/assembleDebug/lintDebug。
- [ ] 生产：只对新迁移dry-run、受保护快照/rollback预演，再应用迁移/admin Edge；合成账号并发调用prepareWrite验证幂等/复用/任务核验并清理自有夹具，不写实体芯片、不碰原录音。
- [ ] 文档与发布：中文指南、API/进度/验证/索引更新；创建PR集成、Pages发布、发布配置APK与校验和；明确真机验收边界。

# 后置分类实施计划

**目标：** 固定四类、统一空卡、录音时原子生成Tokyo日期批次及分类号。

**架构：** 新字段分离历史管理分类与访客主题，保留token和旧录音。数据库事务负责正式编号；客户端不生成生产编号。

**技术：** Postgres/Supabase Edge、React TypeScript、Kotlin Android、Vitest/PGlite/Deno。

- [ ] 集成负责人冻结API_CONTRACT.md，修改共享domain/repository/adapters及其测试。
- [ ] 后端独立目录：新migration固定分类/空卡/原子claim/日序号/重置/更正/筛选/协议3；Edge验证及PGlite/并发/授权测试，合成脚本更新。不得操作生产。
- [ ] 后台独立目录：只填数量开卡、固定分类/日期/待分类筛选，无分类CRUD；旧录音/新号/库存显示，移动只限录音。mock测试按新契约。
- [ ] Android独立目录：统一空卡池写卡、protocol3、固定分类只作录音管理筛选，日期/序列号/库存显示，保留明确覆盖和租约安全；JVM/构建/lint。
- [ ] 集成负责人访客主题映射A-D，提交categoryCode，完成/收听小号显示serialNumber，测试入口支持本地模拟；全前端/两种构建、后端迁移并发测试和独立审查。
- [ ] 集成负责人审计生产迁移dry-run/元数据保护、部署Edge与网页、V3合成云端联调及清理；新APK发布，记录真机未验收边界。

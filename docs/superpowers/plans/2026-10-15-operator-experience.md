# 管理体验实施计划

**Goal:** 按已确认设计同步升级分类管理、网页后台与Android工作人员应用。

**Architecture:** 保留现有React/Vite、Kotlin与Supabase；服务端统一分类/编号、批量操作预检和任务租约。旧访客token与音频不变。迁移脚本先本地验证，不自动重编生产旧卡编号。

## 共享接口冻结

`POST admin-api` 增加下列action（都经过既有Auth与allowlist）：

- `categories` → `{categories:[{id,name,code,nextNumber}]}`。
- `createCategory` `{name,requestKey}` → `{category}`；`renameCategory` `{categoryId,name}` → `{ok:true}`。
- `createCards` `{categoryId,count,requestKey}` → `{tags}`，1–500，幂等。
- `list` 增加 `categoryId,sort`（recorded_desc/recorded_asc/number），tag增加 `categoryId,version`；原batch兼容为分类名称。
- `bulkPreview` `{tagIds,operation,targetCategoryId?}` → `{groups:[{kind:'empty'|'recorded',cards:[{id,version,label}],recordingCount}]}`。
- `bulkApply` `{operation:'move'|'delete'|'reset',cards:[{id,version}],kind:'empty'|'recorded',targetCategoryId?,requestKey}` → `{ok:true}`；版本与组别均服务端重验，每组原子/幂等。
- `jobs` 增加categoryId，job增加categoryId、recordingStatus、lease信息（可空），旧字段保留；支持protocolVersion=2。
- `leaseJob` `{jobId,deviceId,protocolVersion:2}` → `{job,leaseToken,expiresAt}`；`nextJob` `{categoryId,deviceId,protocolVersion:2}`同返回，无任务返回 `{job:null}`。
- `releaseJob` `{jobId,leaseToken}` → `{ok:true}`；`provision` v2附leaseToken、protocolVersion。新管理模型上线后旧protocol写卡返回CLIENT_UPGRADE_REQUIRED。

现存分类迁移不自动给真实旧卡换号：保留旧label和URL，以旧batch规范化回填分类；按历史label匹配预留编号，生成器跳过全部历史编号。新建/移动采用自动号。正式重编号另需迁移预检确认。

## 工作包

- [ ] 后端：新migration、分类/历史号/软删除/版本触发器/原子批量操作/租约；先写SQL失败用例，再实现并PGlite重放；Edge授权测试新增action与稳定错误码。生产资源不由子任务修改。
- [ ] 集成：扩展 `src/storage/adminRepository.ts` 和cloud adapter，新增契约测试并观察红绿；更新API契约、生产迁移预检与全量回归。
- [ ] 网页：拆出分类导航、批量工具与确认对话框；先写交互测试，覆盖创建自动号、筛选排序、跨分类移动、分组确认、过时预检、取消/重试；保留认证、CSV导出和试听。
- [ ] Android：三语、Keystore会话/串行刷新、管理/单张/自动/编辑分屏、租约写卡状态机、自动同步；先写纯Kotlin状态测试，编译与lint，物理验收不能模拟替代。
- [ ] 验证：前端全测试与两种构建、Deno授权、SQL重放/回滚、并发号与租约、截图桌面/手机、Android测试/构建/lint；真实数据迁移与实体写卡单列记录。

## 每包执行顺序

先读现有文件和契约；新增最小失败测试并运行确认失败；按接口实现；重跑针对测试；集成负责人审差异并跑全量；记录证据后提交。共享边界只有集成负责人修改，后端/网页/Android限定各自目录。

## 发布门槛

不能只发布网页而让旧安卓静默误写。迁移及Edge兼容先验证，两端构建成套交付；旧安卓阻断需明确升级提示。真实项目迁移前读取统计、确认映射、备份/回滚路径；不能在自动测试中改变真实卡片身份。所有权限和URL不变规则须回归。

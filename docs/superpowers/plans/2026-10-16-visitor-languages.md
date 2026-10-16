# 参观者五语实施计划

**目标：** 日语默认，参观者全流程增加英语、韩语和繁体中文。

**架构：** 保留现有消息键，新增独立访客词典覆盖与步骤/政策键；I18nProvider统一查表。共享后台词条保留既有语言，不修改后端。

**技术：** React、TypeScript、Vitest、原生select、Playwright。

- [x] src/i18n/messages.test.tsx增加五语菜单/恢复/默认回归，先执行npm test -- --run src/i18n/messages.test.tsx观察缺少菜单失败。
- [x] src/i18n/visitorMessages.ts增加有类型校验的完整访客翻译；I18nProvider合并词典并验证偏好值；LanguageSwitch添加访客菜单模式。
- [x] VisitorPage将所有内联双语转为词条；PolicyPage移除双语条件；LocationPicker按五语映射首次加载，保留地图实例。
- [x] 更新访客切换测试并逐语验证主题/录音/确认，测试缺失词条和占位符一致性。
- [x] npm test -- --run、npm run test:backend、npm run build、GITHUB_PAGES=true npm run build；Playwright窄屏菜单/长文案检查、独立审查和文档更新完成。
- 发布门槛：合并后等待Pages成功，再以正式域名验证五语菜单；未通过不得宣称上线。

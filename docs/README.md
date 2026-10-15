# 项目文档索引

开始任何系统任务前先读本页和 [`../AGENTS.md`](../AGENTS.md)。本目录是产品范围、跨端架构与接口约定的唯一文档来源。

## 核心文档

- [地图兼容发布](MAPS_COMPATIBLE_RELEASE.md)：地图独立发布与旧安卓写卡协议的兼容边界。
- [Google 地图接入记录](GOOGLE_MAPS_SETUP.md)：云配置、配额与验证状态。

- [项目目标与需求](PROJECT.md)：用户、角色、工作流、范围和验收标准。
- [系统架构](ARCHITECTURE.md)：客户端边界、云服务、数据流和仓库演进方向。
- [API 契约](API_CONTRACT.md)：访客、后台、Android 写卡端共用的服务端接口。
- [安全与隐私](SECURITY_PRIVACY.md)：音频、token、权限、保留和删除规则。
- [开发与环境](DEVELOPMENT.md)：当前原型状态、环境变量、测试和部署约定。
- [路线图](ROADMAP.md)：阶段顺序、依赖和可并行工作包。
- [架构决策记录](DECISIONS.md)：已采纳方案、被否决方案和仍需用户确认的决策。
- [执行计划](IMPLEMENTATION_COMPLETION.md)、[首次运营](OPERATOR_SETUP.md)、[验证记录](VERIFICATION.md)：本轮交付和实体验收。

## 当前开发重点

云端录音、运营后台和 Android 调试端已实现。可选Google地图选点已兼容发布，并通过正式网站双独立浏览器云端录音/地点/播放验证。管理V2仍保留在独立开发分支，未随地图发布。当前剩余为实体iPhone/NFC验收、保存期限及现场运营安排，见地图兼容发布记录。

旧的 `docs/superpowers/specs/2026-09-29-exhibition-audio-nfc-design.md` 和早期原型计划记录了单浏览器原型阶段的决定；如与本文档冲突，以本目录核心文档为准。

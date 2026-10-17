# 项目文档索引

开始任何系统任务前先读本页和 [`../AGENTS.md`](../AGENTS.md)。本目录是产品范围、跨端架构与接口约定的唯一文档来源。

## 核心文档

- [工作人员网站接入](STAFF_PORTAL_SETUP.md)：一个共享账号、自选记忆身份、受限审核与发布步骤。
- [工作人员网站设计](superpowers/specs/2026-10-17-staff-review-portal.md)：现场列表、转写审核、地图与审计边界。

- [工作人员主题管理简化](superpowers/specs/2026-10-17-simplify-operator-themes.md)：四主题自动编号保留，工作人员不再手动分类，按日期/搜索/状态管理。

- [二维码与 NFC 补卡工程说明](QR_NFC_WORKFLOW.md)：二维码已上线能力、跨端身份关系、Android 补卡候选设计、失败恢复和验收，是二维码流程主文档。
- [二维码初版计划](superpowers/plans/2026-10-17-qr-fallback.md)、[所有工作人员接入计划](superpowers/plans/2026-10-17-qr-fallback-all-staff.md)：历史实施依据，当前状态以上述工程说明为准。

- [按需开卡与强反馈设计](superpowers/specs/2026-10-17-on-demand-writing-design.md)：取消先开卡的必经步骤、连续写卡弹窗与安全重试。

- [语音转文字试用接入](TRANSCRIPTION_SETUP_ZH.md)：Groq 可选同意、私有草稿、审核发布、密钥配置与验收步骤。
- [后台拼装板定位与转写状态设计](superpowers/specs/2026-10-17-admin-map-piece-assignment-design.md)：73块板定位、审核状态、失败隔离与人工修正边界。
- [后台拼装板定位实施计划](superpowers/plans/2026-10-17-admin-map-piece-assignment.md)：固定地图来源、坐标校准、提交后自动建议和运营手动修正的分阶段验收。
- [73块地图数据与坐标校准](MAP_PIECE_DATA.md)：固定轮廓来源、坐标变换证据、审核边界和估算准确性限制。
- [后台转写状态实施计划](superpowers/plans/2026-10-17-admin-transcription-status.md)：列表状态摘要与筛选，不泄露转写正文。

- [后置分类V3](superpowers/specs/2026-10-16-post-recording-classification.md)：固定四类、统一空卡池、录音日批次与不复用编号；取代旧分类开卡规则。

- [可重复参观测试入口](superpowers/plans/2026-10-16-visitor-preview.md)：`#/preview`始终可重新体验，不上传正式录音。

- [参观者五语设计](superpowers/specs/2026-10-16-visitor-languages-design.md)：日语默认、中文简繁/英语/韩语、菜单和后台兼容边界。

- [户外参观流程设计](superpowers/specs/2026-10-16-visitor-outdoor-design.md)：五步编号、研究室视觉、无昵称与第一版主题边界。

- [地图兼容发布](MAPS_COMPATIBLE_RELEASE.md)：地图独立发布与旧安卓写卡协议的兼容边界。
- [Google 地图接入记录](GOOGLE_MAPS_SETUP.md)：云配置、配额与验证状态。

- [当前进度与交接](STATUS.md)：阶段结论、事实、待办与本地工作目录。
- [体验优化阶段](EXPERIENCE_PHASE.md)：下一阶段三端目标、范围与待确认事项。
- [管理体验正式设计](superpowers/specs/2026-10-15-operator-experience-design.md)：已确认的分类、编号、网页管理和安卓独立写卡模式。
- [V2发布检查](OPERATOR_V2_RELEASE.md)：候选版、迁移顺序与旧安卓升级限制。
- [安卓V3中文操作说明](ANDROID_V2_GUIDE_ZH.md)：统一空卡池、升级、五个入口、版本校验与实体手机验收。
- [NFC读取设计](superpowers/specs/2026-10-16-nfc-reader-design.md)：Android 2.1独立只读入口与离线/云端确认边界。
- [项目目标与需求](PROJECT.md)：用户、角色、工作流、范围和验收标准。
- [系统架构](ARCHITECTURE.md)：客户端边界、云服务、数据流和仓库演进方向。
- [API 契约](API_CONTRACT.md)：访客、后台、Android 写卡端共用的服务端接口。
- [安全与隐私](SECURITY_PRIVACY.md)：音频、token、权限、保留和删除规则。
- [开发与环境](DEVELOPMENT.md)：当前原型状态、环境变量、测试和部署约定。
- [路线图](ROADMAP.md)：阶段顺序、依赖和可并行工作包。
- [架构决策记录](DECISIONS.md)：已采纳方案、被否决方案和仍需用户确认的决策。
- [执行计划](IMPLEMENTATION_COMPLETION.md)、[首次运营](OPERATOR_SETUP.md)、[验证记录](VERIFICATION.md)：本轮交付和实体验收。

## 当前开发重点

实体卡不足或参观者手机不能读取NFC时，工作人员可从`#/staff/qr`为其签发二维码；运营入口`#/admin/qr`保留。扫码沿用原访客录音/收听流程，不新增角色。基础流程随PR #23发布，当前标签页的列表回看随PR #26发布；刷新保留列表，退出时清除，不跨手机同步。

2026-10-18新增[Android补卡联动候选设计](QR_NFC_WORKFLOW.md)：录音后找到原QR记录，向空白芯片补写同一稳定URL，而非迁移音频或新建身份。此能力尚未实现，不可把当前APP查询到录音等同于可补卡；计划与现有NFC空卡池隔离，详见[路线图](ROADMAP.md)。二维码双手机、展厅网络和实体NFC仍需按[验证记录](VERIFICATION.md)现场验收。

旧的 `docs/superpowers/specs/2026-09-29-exhibition-audio-nfc-design.md` 和早期原型计划记录了单浏览器原型阶段的决定；如与本文档冲突，以本目录核心文档为准。

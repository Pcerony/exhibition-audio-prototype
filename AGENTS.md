# Agent 工作约定

本仓库是「福冈市声音记忆展览系统」的单体仓库。开始任务前先读 [`docs/README.md`](docs/README.md)，再按任务读取产品、架构、API、安全和路线图文档。

## 当前事实

- 生产 React/Vite 应用使用云端录音和认证后台；本地 IndexedDB/localStorage adapter 仅供开发/测试。
- 已有正式预览域名 `https://voice.heisei.space/`，由 GitHub Pages 托管前端。
- 已确认芯片可以写入网址，但芯片型号、容量和手机兼容性尚未实测。
- 东京 Supabase 已配置，独立 HTTP 客户端合成音频绑定/播放已验证；不等于两台手机/实体 NFC 验收。真实账号、保留策略和现场验收仍需负责人，见 `docs/VERIFICATION.md`。

## 不可各自发明的系统规则

- 参观者免安装、免账号；运营者必须认证。
- 每枚芯片预先写入不同的、由系统生成的稳定 HTTPS 网址。网址承载不透明随机 token；不得用标签序号或 NFC UID 作为公开身份。
- NFC 芯片只保存网址，不保存音频。音频、绑定关系和状态以云端为准。
- 一枚芯片最多一段有效录音；绑定必须服务端原子化。参观者 token 不能执行重置、覆盖或管理操作。
- 不得把 Supabase `service_role` 或其他服务端密钥放进网页、Android 包、CSV、日志或提交记录。
- 参观者音频由私有对象存储托管；公共播放经服务端授权后生成短期签名 URL。
- 同一母网址写入所有芯片无法让网页识别参观者碰到哪一枚芯片。若提议改变此规则，先更新架构决策并说明用户流程影响。

## 并行开发规则

- 先稳定 [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) 中跨端接口，再并行开发调用方。接口变更需同步更新契约、后端和契约测试。
- 默认按目录分工：`supabase/` 后端；`src/features/visitor/` 参观者 UI；`src/features/admin/` 运营 UI；未来 `apps/tag-writer-android/` 原生写卡端；`docs/` 系统文档。
- `src/App.tsx`、`src/domain/`、`src/storage/repository.ts`、依赖清单、部署工作流和公共 API 契约属于共享边界。不要让多个 Agent 同时改同一边界文件；先由集成负责人拆分接口或指定单一所有者。
- 一项任务一个分支或 worktree；合并前集成负责人检查差异、运行完整测试和构建。Agent 报告不能替代本地验证。
- 不提交真实用户音频、生产密钥、`.env`、个人身份信息或未授权的数据库 dump。文档和测试只用虚构数据。
- 生产数据、DNS、Supabase 项目和 GitHub Pages 设置只能由集成负责人按用户授权操作；不要在并行子任务里擅自改生产资源。

## 必须验证

- 前端：`npm test -- --run`、`npm run build`，以及适用时 `GITHUB_PAGES=true npm run build`。
- 后端：migration dry-run、RLS/Edge Function 授权测试、并发绑定测试和上传失败清理测试。
- NFC 写卡：实体标签写后读回，确认写入的完整 URL 与服务端 provisioning job 一致。
- 集成：用两个独立浏览器/手机验证一端录音绑定、另一端扫码播放；不得以同一浏览器本地存储测试代替云端验证。

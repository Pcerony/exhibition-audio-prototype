# 可选地点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成简单的 Google 地图选点、可跳过录音流程、云端地点保存和后台查看，验证后发布。

**Architecture:** 沿用现有 React repository 与 Supabase 原子 claim 边界，地点作为可空录音元数据。地图独立组件按需加载，不改变 NFC URL 和权限模型；Google 搜索字段按内容存储政策处理。

**Tech Stack:** React、TypeScript、Google Maps JavaScript API/Places New、Supabase Postgres/Edge Functions、Vitest。

## 1. 云配置与政策

- [ ] 查询实际 Maps/Places 配额和调整能力，设置保守上限，记录每个成功/失败结果；不把预算提醒当硬上限。
- [ ] 核对 Google 当前 Places ID、坐标、署名存储规则，冻结 location DTO；浏览器密钥仅保存于受控环境配置。

## 2. 契约与云端

涉及 `docs/API_CONTRACT.md`、`src/domain/tags.ts`、`src/storage/repository.ts`、`supabase/functions/public-upload-claim/index.ts`、`supabase/functions/public-tag/index.ts`、新 migration 和 `supabase/tests/`。

- [ ] 先添加非法来源、越界坐标、超长描述、空地点兼容测试，运行并确认失败。
- [ ] location 可空；手动点保存坐标，搜索结果保存 place ID；接口返回与提交一致。SQL 在现有 claim 事务内存储，不做独立补写。
- [ ] 重置/删除不保留孤立地点；重复 claim 不改获胜录音地点；匿名不能独立更新位置。
- [ ] 运行 migration dry-run、授权与真实连接并发测试；保留现有生产数据。

## 3. 前端与后台

涉及 `src/features/visitor/LocationPicker.tsx`、`VisitorPage.tsx`、`visitor.css`、现有 i18n、`src/storage/supabaseVisitorRepository.ts` 和后台详情展示。

- [ ] 先写未绑定先选点、跳过、确认、返回修改、加载失败、token 变化清空地点的测试，确认失败。
- [ ] 地图默认福冈市但不默认选中，搜索或拖动后明确确认；只保留确认与跳过两个主操作，不请求 GPS。
- [ ] 已绑定卡片直接播放；地图错误不阻塞录音；昵称仍放录音之后。
- [ ] repository 传递 location，内存 adapter 同步行为；后台地点按文本安全展示，提供地图入口。
- [ ] 日中双语文案与隐私说明覆盖地点公开提醒。

## 4. 验证、兼容发布与交接

- [ ] 执行 `npm test -- --run`、`npm run build`、`GITHUB_PAGES=true npm run build`。
- [ ] 桌面和手机尺寸截图检查，真实地图加载/搜索/拖动验证。
- [ ] 检查分支中尚未发布的管理 V2，隔离地图兼容发布，或严格执行 `docs/OPERATOR_V2_RELEASE.md`，不得暗中使旧 APK 失效。
- [ ] 生产迁移前备份与预演；更新部署配置；发布后双独立浏览器验证地点与录音云端读取。
- [ ] 更新状态和验证记录，明确真人手机麦克风/NFC 回归与费用保护的剩余边界。

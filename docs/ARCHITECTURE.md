# 系统架构

## 系统边界

单一单体仓库、三个客户端、一个共享云后端：

```text
参观者 iPhone/Android 浏览器 ─┐
运营管理 Web ────────────────┼── HTTPS API ── Supabase Postgres + 私有 Storage
运营者 Android 写卡 App ─────┘                  ├─ Edge Functions / 原子数据库操作
                                                └─ Auth + RLS + 审计记录
```

前端静态资源继续部署在 GitHub Pages 和 `voice.heisei.space`。Supabase 承载云数据库、私有音频对象、认证和受控 API。GitHub Pages 不存放服务端密钥，也不承载音频对象。

## 核心 NFC 决策

芯片网址必须每枚不同，例如 `https://voice.heisei.space/#/t/<opaque-token>`。所有网址属于同一个母网站，但 URL token 让网页能查到确切的云端标签。Android 原生写卡端负责创建/领取 provisioning 批次、写入 NDEF URI 并读回验证；参观者网页不需要 NFC Web API。

如果所有芯片都只写完全相同的母网址，网页不能知道参观者碰了哪一枚芯片，也不能在第一次接触后正确绑定录音。NFC UID 不作为跨端身份：它可能受标签和设备实现限制，系统身份统一由服务端生成的随机 token 承载。

因此正式参观流程只需碰一次、且在录音之前。音频上传成功后由服务端绑定到该 token，不需要录完再碰或改写芯片。芯片写入是运营准备阶段，不是参观者每次录音的环节。

## 目标仓库分区

当前仓库是一个 Vite 应用，visitor/admin 路由共用 `src/`；不要为首个云存储适配器而一次性重写或移动整个应用。演进目标：

```text
apps/
  visitor-web/             # 现有参观页面逐步迁入
  admin-web/               # 后台可先留在同一 Vite app，再按需拆分
  tag-writer-android/       # Kotlin 原生 NFC NDEF 写卡工具
packages/
  api-contracts/            # 共享 DTO、状态和验证定义
supabase/
  migrations/
  functions/
  tests/
docs/
```

迁移目录要作为单独任务，不与云端数据正确性实现捆绑。首阶段可在现有 `src/storage/` 下新增 Supabase repository adapter，并通过已有 `TagRepository` 边界连接参观者 UI。

## 技术选择

- 前端：保留 React、TypeScript、Vite；访客免安装。Android 写卡：原生 Kotlin + Android NFC/NDEF API。
- 云端：MVP 采用 Supabase Postgres、Storage、Auth、Edge Functions。数据库唯一约束/事务守住一标签一录音；服务端函数签发上传/播放 URL 并进行输入校验。
- 音频：只放私有 Storage bucket，数据库仅保存对象路径和最小元数据；播放时经服务端生成短期 signed URL。
- 域名：访客稳定 URL 为 `voice.heisei.space`；生产前端和 Supabase API 域名相互独立。
- 语言：参观者和后台沿用现有简体中文/日语 i18n。Android 第一版至少中/日/英错误码本地化，写卡数据不依赖 UI 语言。

## 数据所有权和服务边界

- Postgres：标签、录音元数据、上传会话、写卡批次/作业、运营审计；不存放二进制音频。
- Storage：音频对象，私有 bucket；对象路径由服务端生成，客户端不能传任意路径。
- Edge Functions/受控服务层：访客查标签、初始化上传、完成绑定、获取播放链接；管理端认证/批量管理/重置；写卡端的批次 provisioning API。
- 浏览器/Android 客户端：只持有公开 anon key 和用户会话 token；任何 service-role key 永不进入客户端。

## 关键状态

标签云状态：`unbound -> bound -> unbound`（认证重置）或 `disabled`。物理写卡状态单独维护：`pending -> verified`，可转为 `failed` 或通过显式重写回到 `pending`。写卡状态不能决定录音绑定状态。

录音绑定通过服务端原子操作和 `recordings.tag_id UNIQUE` 约束实现。上传对象创建成功不等于绑定成功；只有 finalize/claim 成功后才对外显示录音。竞争失败者的对象进入清理流程。

## 运维约束

本地、preview、production 使用分开的 Supabase 项目/密钥，开发和并行 Agent 使用本地 Supabase 或隔离项目。迁移是 schema source of truth。生产变更先备份、预演 migration，并明确回滚/前向修复策略。Supabase 区域须在确定数据政策和账号配置后选择，优先靠近日本用户；不可由 Agent 擅自开生产项目或粘贴密钥。

# 开发与环境

## 当前仓库状态

根目录是现有 React/Vite 双语原型：`src/features/visitor/` 参观者页面，`src/features/admin/` 运营页面，`src/storage/repository.ts` 为本地 localStorage + IndexedDB 适配器。应用部署在 GitHub Pages，自定义域名为 `https://voice.heisei.space/`。当前数据只对同一浏览器可见。

正式 Supabase 项目、schema、Storage bucket、Edge Functions、管理员账号和 Android 工程尚未配置。任何 Agent 必须先读 [`PROJECT.md`](PROJECT.md)、[`ARCHITECTURE.md`](ARCHITECTURE.md)、[`API_CONTRACT.md`](API_CONTRACT.md) 和 [`SECURITY_PRIVACY.md`](SECURITY_PRIVACY.md)。

## 本地前端

```sh
npm ci
npm run dev
npm test -- --run
npm run build
GITHUB_PAGES=true npm run build
```

Vite 当前使用根目录单包。做云端 adapter 时保留 repository 边界；不要在 Supabase 不可用时静默降级到本地数据。开发模式可由显式 `APP_STORAGE_MODE=local` 使用本地 adapter；集成环境必须显示当前模式，production 必须要求配置 Supabase。

## 环境变量

前端允许的变量仅为公开值：

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_APP_ENV=local
```

服务端 Edge Functions secrets 通过 Supabase CLI/项目 secret manager 设置，例如 `SUPABASE_SERVICE_ROLE_KEY`、token pepper、rate-limit 配置；不得放进 `.env` 前端变量、提交记录或聊天。添加 `.env.example` 时只放空值/明显 placeholder。Android 签名 keystore 和 OAuth redirect settings 通过安全渠道管理。

## Supabase 工作约定

- 本地开发使用 Supabase CLI + Docker（若可用）或独立 dev project；不在 production 项目试 schema。
- 所有 schema 变化放在 `supabase/migrations/` 并可从空数据库重放。RLS 和对象策略随 schema 一起测试。
- 部署前检查目标项目 ref、当前分支和 migration diff。production 数据操作要备份并经用户/项目负责人授权。
- 管理登录、参观者匿名 API、Android provisioning API 必须按 [`API_CONTRACT.md`](API_CONTRACT.md) 与安全文档验证。

## GitHub Pages

前端仍使用 `.github/workflows/deploy-pages.yml` 部署；workflow 测试、相对资源路径兼容自定义域名和项目 Pages 路径。新增 Supabase secrets 时只添加需要的公开 URL/anon key 到静态构建；service role 永远不能作为 Vite build arg。API CORS/redirect URL 仅允许 `https://voice.heisei.space`、localhost 和明确测试域名。

## 真机验收设备

- iPhone Safari 与 Chrome：NFC URL 打开、系统和站点麦克风授权/拒绝恢复、录音格式、上传/试听、切后台/锁屏、回访播放。
- Android Chrome：网页访客播放/录音；原生写卡另测 Android NFC reader mode 和 NDEF read-back。
- 至少两台彼此独立的设备/浏览器验证云端数据共享；同一浏览器的 IndexedDB 不构成云端测试。

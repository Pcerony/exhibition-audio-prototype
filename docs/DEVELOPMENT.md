# 开发与环境

生产 React/Vite 应用使用 cloud repository 访问 Supabase；本地 adapter 仅供开发/测试。域名为 `https://voice.heisei.space/`，东京项目已部署 migrations 和六个 Edge Functions。正式访客数据尚未开始收集。

## 前端

```sh
npm ci
npm run dev
npm test -- --run
npm run test:backend
npm run build
GITHUB_PAGES=true npm run build
```

公开变量见 `.env.example`：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。配置存在时使用云端；开发缺配置使用本地 adapter，生产缺配置失败关闭。不得用 VITE 变量暴露服务端密钥。

## 后端

见 [Supabase 说明](../supabase/README.md)。不修改已经应用的 migration。管理 API 验证 Auth 用户和 operator_profiles；登录成功不等于运营授权。

```sh
npx supabase db push --linked --dry-run
npx supabase db query --linked --file supabase/tests/operator_management.sql
```

第二条运行回滚测试，只使用虚构数据。所有生产操作需项目负责人授权并检查 linked project。

嵌入式数据库测试：`npx deno@2.9.6 test --node-modules-dir=auto --allow-read --allow-env --allow-sys --allow-ffi --no-lock supabase/tests/local_database_test.ts`；之后 `npm ci` 恢复前端依赖布局。PGlite 的 Auth/Storage/密码学替代并非完整 Supabase 栈。

`scripts/verify-cloud.mjs` 为 opt-in 远程合成数据集成测试，创建后清理虚构账号/展签/音频。`scripts/configure-maintenance.mjs` 将秘密通过管道设置为 Edge secret/Vault，不打印秘密。

## Android 与部署

Android 使用 JDK17、SDK36 和固定校验和 Gradle wrapper，见 [工程说明](../apps/tag-writer-android/README.md)。只注入公开 URL/key；调试 APK 不是正式签名发布版。

Pages workflow 在 main 更新时测试/构建，配置来自 Actions Variables。云端部署独立，先兼容契约再上线前端。实体 iPhone、Android NFC、两台手机互通和保留策略验收参照 [首次运营](OPERATOR_SETUP.md)。

# 开发与环境

生产 React/Vite 应用使用 cloud repository 访问 Supabase；本地 adapter 仅供开发/测试。域名为 `https://voice.heisei.space/`；正式访客数据与状态以云端 Supabase 为准，本地 adapter 不是生产数据源。

## 可回退的功能开发

- 新功能在独立 worktree/分支中进行；开始前记录基线提交和需求/实施计划，不把主工作目录中已有的未提交文件带入或覆盖。
- 每个可独立验证的功能阶段先运行对应测试，再单独提交；仅在检查提交内容未包含用户数据、音频、身份信息、密钥或私有备份后推送功能分支并创建带说明的 checkpoint tag。
- checkpoint tag 指向已验证的 Git commit。恢复时先保留当前工作，再从目标 tag 建立新 worktree，例如：`git worktree add ../exhibition-audio-recovery -b codex/recovery <checkpoint-tag>`；不要通过重置或强制推送覆盖共享历史。
- 自动部署成功不等于生产数据库/Edge Function 已变更。生产 migration、云端数据、域名和正式发布仍由集成负责人按单独授权、备份和验收流程执行。

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

V2独立PostgreSQL并发回归可用临时依赖执行，不修改项目依赖：

```sh
npm install --prefix /tmp/exhibition-pg-runtime --no-audit --no-fund embedded-postgres@17.9.0-beta.17 pg@8.16.3
EMBEDDED_PG_RUNTIME=/tmp/exhibition-pg-runtime node supabase/tests/postgres_concurrency.mjs
```

该脚本只创建本机临时数据库，禁止传生产连接串，结束自动关闭。它验证实际多连接事务，但Storage/Auth仍是虚构表，不代表完整Supabase栈或物理NFC验收。

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

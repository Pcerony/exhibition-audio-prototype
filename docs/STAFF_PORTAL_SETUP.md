# 工作人员网站接入

工作人员独立入口为 `https://voice.heisei.space/#/staff`，不替换完整后台和安卓写卡端。2026-10-17生产迁移003/004/005、三个Edge Functions和独立共享staff账号已配置并通过云端合成联调；前端随本次PR发布，实际发布完成以GitHub Pages成功记录及线上页面核验为准。

## 一个共享账号

工作人员页面使用固定账号名 `staff` 和一个共享密码，不需要真实邮箱，不为每个成员开账号。页面将账号名映射到内部 Auth 标识 `staff-portal@staff.invalid`；该标识不是收件邮箱，不用于发信。其他账号名和邮箱不能通过此页面登录。密码仍由 Supabase Auth 验证，网页不保存明文密码。

由集成负责人通过受控的 Supabase Auth Admin API 创建此唯一账号，设置 `email_confirm: true`，不发送邀请或确认邮件、不关闭整个项目的邮箱确认。生成的密码只写入仓库之外的本机私有交接文件（目录0700、文件0600），不可写入代码、日志或提交。将该账号的 Auth UUID 在 `public.operator_profiles` 中配置为 `staff` 角色。只在受控 SQL 控制台执行，例如：

```sql
insert into public.operator_profiles(user_id, role)
values ('<共享账号的 Auth UUID>'::uuid, 'staff')
on conflict (user_id) do update set role = excluded.role;
```

不要将原最高权限账号改成 `staff`，也不要重用其密码。共享账号必须是独立的 `staff` 用户；页面也会拒绝恢复或登录 `admin`/`operator` 会话，防止把配置错误的高权限账号交给工作人员。后台API继续在服务端检查角色，隐藏网址不是访问控制。

没有真实收件邮箱，因此不提供邮件找回密码；忘记密码由负责人在受控 Auth Admin 界面重设，随后重新验证角色。手机记住的是可续期会话，不是密码。

登录后从八位研究室成员中选择名字。名单按负责人指定的[研究室成员页](https://www.sodes.org/ja/members.html)录入，排除張彦芳与Zoé Láscari。手机记住会话和所选成员，支持切换成员、退出登录；这是共享账号下自报身份，不是个人账号认证。

## 发布顺序

以下步骤1至3已于2026-10-17执行；后续重部署仍须复核，不要重复创建共享账号或重复执行迁移。

1. 审查并备份数据库，核对已应用迁移。此分支基于73板地图候选，须依次应用尚未应用的迁移，包括地图相关003/004和 `202610170005_staff_portal.sql`，不可只拷贝前端。
2. 依次部署本候选修改的 `admin-api`、`public-upload-claim` 和新增的 `staff-api` Edge Functions。前两者包含后台拼装板筛选/修正及新录音的拼装板归属处理；Pages工作流只发布静态前端，不会部署Edge Functions。函数自行验证Bearer JWT和数据库角色，使用既有私有音频bucket和服务端密钥配置；密钥不可放入Vite。
3. 配置上述唯一共享账号。用它验证工作人员入口可用、完整后台API被拒绝。
4. 确认上述三个Edge Functions部署成功，再运行前端测试及Pages构建并发布前端；浏览器需要既有Supabase公开配置及Google Maps公开API key，继续使用现有允许来源约束。
5. 两个独立手机/浏览器验证新录音置顶、时间、私有草稿、试听、定位、批准后公开和同时修改冲突；完整后台、Android写卡与旧URL做回归。

新迁移还为AI完成补充版本递增，保持原worker接口不变，防止审核者基于旧的空文本覆盖刚生成的结果。审核保存会撤销旧AI租约。迁移必须先在隔离数据库演练，再由负责人按授权操作生产。

## 本地试用

`npm ci` 后运行 `npm run dev -- --host 127.0.0.1 --port 5197`，访问 `http://127.0.0.1:5197/scripts/staff-preview.html`。不能用 `file://` 打开源文件。此开发入口调用真实工作人员组件、使用虚构卡片和合成音频，带有醒目标识，不读取或写入生产数据，不进入生产构建。正式路由缺少云配置时拒绝进入，不降级到假数据。

Google嵌入地图还受key来源限制；现有key允许5173而非5197，因此5197预览不能据此验收Google嵌入地图。73板定位图与Google外链可独立检查，不要为本地预览擅自修改生产key设置。拼装板位置是系统推算，不证明立牌实际摆放位置。

可重复的隔离数据库测试：先在临时目录安装 `embedded-postgres` 和 `pg`，再设置 `EMBEDDED_PG_RUNTIME` 为该目录运行 `node supabase/tests/postgres_staff_portal.mjs`。脚本使用临时数据库，不连接生产；默认本地端口55448，可用 `TEST_POSTGRES_PORT` 改端口。

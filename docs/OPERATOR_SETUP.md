# 首次运营与试点

## 创建运营账号

Supabase 打开 **Authentication → Users → Add user**，创建自己的邮箱/密码账号并确认邮箱。不要把密码发到聊天、写进代码或 CSV。网页不提供公开注册。

在 **SQL Editor** 执行下列语句，替换占位邮箱。这只授予权限，不创建账号：

```sql
insert into public.operator_profiles (user_id, role)
select id, 'admin' from auth.users
where lower(email) = lower('your-email@example.com')
on conflict (user_id) do update set role = excluded.role;
```

确认影响 1 行；0 行表示邮箱未匹配。临时测试账号已经删除，不用于正式登录。

## 创建与写入试验展签

登录 <https://voice.heisei.space/#/admin>，先创建 2–3 枚虚构展签。CSV 两列为 `展签编号,批次`。完整网址由系统生成，必须原样使用，不要给所有芯片写同一个母网址。

在支持 NFC 的安卓手机安装调试 APK，登录同一运营账号、选择批次/任务并启动写卡。只有物理读回得到完全相同的网址才报告 verified。未格式化标签按提示再次触碰；首次必须确认芯片容量、可写性和 iPhone URL 打开兼容性。目前未完成实体芯片验收。

## 两台手机试点

手机 A 触碰未绑定标签，录制、试听、提交；手机 B 触碰同一标签，应只能播放 A 的声音。后台显示绑定。再由后台重置，确认恢复录制且旧上传无法补绑。

参观者只需接触一次芯片：网址已经携带标签 token，提交后绑定发生在云端，芯片不改写。分别验收 iPhone Safari/Chrome、Android Chrome，包括拒绝权限恢复、锁屏/切后台、断网。

重置对象和失败候选进入安全清理队列，可能等待上传凭证到期。定时回收不删除仍有效的展览录音。

## 正式开放前

确定保存/删除期限、公开收听告知、删除申请联系方式和现场网络，完成备份恢复与实体验收。未决定留存策略前，系统不会擅自按展期删除有效录音。

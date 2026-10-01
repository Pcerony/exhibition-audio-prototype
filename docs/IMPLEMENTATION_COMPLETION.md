# 独立交付执行计划

本轮依据已批准的系统规划执行，不改变 NFC 一卡一网址、一卡一录音、匿名参观和认证运营规则。

## 接口冻结

管理和 Android 共用 `POST /functions/v1/admin-api`，请求含 `action`，Bearer 为 Supabase Auth access token。服务端查询 `operator_profiles` 验证角色；没有角色的已登录用户也不能调用。

- `session`：返回 `{userId,role}`。
- `list`：请求 `search,status,offset,limit`，返回 `{tags,total}`。tag 为 `id,token,label,batch,status,createdAt,recording,provisioning`；recording 为 `id,nickname,duration,mimeType,createdAt`；provisioning 为下面的 job。
- `createBatch`：请求 `requestKey`（UUID）、`rows:[{label,batch}]`（1–500项），全批原子创建，幂等重放返回相同 `{tags}`。公开 token 仅由数据库生成。
- `reset`：请求 `tagId`，原子解除绑定、失效旧上传会话、写审计并队列回收旧对象。返回 `{ok:true}`；重复重置安全。
- `setEnabled`：请求 `tagId,enabled`，返回 `{ok:true}`，启用时按有无录音恢复 bound/unbound。
- `playback`：请求 `recordingId`，返回 `{url,expiresInSeconds:120}`。
- `jobs`：请求可选 `batch,status,offset,limit`，返回 `{jobs,total}`，单页最多500项，按稳定 job ID 排序；并发新增/删除或筛选成员变化时须刷新。
- `provision`：请求 `jobId,version,visitorUrl,status`（verified/failed）、可选 `errorCode`。只有完整网址匹配且版本相同才接受，verified重复上报幂等。返回 `{ok:true}`。
- `audit`：返回 `{entries}`，最近100项，仅包含动作、操作者、内部标签ID与时间。
- `maintenance`：回收队列及过期未绑定上传，返回 `{removed,pending}`；也由服务端计划任务调用专用 `maintenance` function。

job 为 `{id,tagId,label,batch,visitorUrl,version,status,errorCode}`。visitorUrl固定由服务端配置的 `https://voice.heisei.space/#/t/<token>` 生成；客户端不能替换域名。

## 文件所有权与步骤

- 后端：`supabase/**`。新增认证、批量建签/作业、原子重置、审计、清理队列与授权测试。禁止子任务部署生产。
- 后台：`src/features/admin/CloudAdminPage*` 与专用样式/文案。登录、分页搜索筛选、CSV、试听、重置/停用、写卡状态、审计。
- Android：`apps/tag-writer-android/**`。Kotlin原生登录、作业领取、NDEF URI写入读回、失败恢复与进度；公开配置外不包含任何秘密。
- 集成：共享 `src/storage/cloudAdminRepository.ts`、App路由、docs与部署、云端集成脚本。真实云端测试仅用虚构标签和生成的短音频，结束清理，不录制个人声音。

## 验证与外部依赖

每个模块先添加失败测试再实现。集成执行前端全测试、普通及Pages构建；迁移dry-run、授权/RLS、并发绑定、失败上传清理、重置及独立访客播放验证。Android工程尽可能编译，实体写后读回不能以模拟代替。

管理员真实账号/允许名单、正式数据保留期限、实体NFC及iPhone录音测试由负责人参与。本轮不擅自创建运营者身份、不接受真实访客音频作测试。

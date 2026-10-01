# 福冈市声音记忆展览系统

参观者触碰 NFC 展签，免安装打开网页，录制一段福冈回忆；之后触碰同一展签只播放该声音。日语默认，可切换中文。芯片只保存唯一网址，录音与绑定关系存于 Supabase 云端。

- 参观者入口：<https://voice.heisei.space/>
- 认证运营后台：<https://voice.heisei.space/#/admin>
- [Android 写卡工程](apps/tag-writer-android/README.md)
- [系统文档](docs/README.md)、[首次运营](docs/OPERATOR_SETUP.md)、[验证记录](docs/VERIFICATION.md)

## 开发

```sh
npm ci
npm run dev
npm test -- --run
npm run test:backend
npm run build
GITHUB_PAGES=true npm run build
```

公开配置参照 `.env.example` 和开发文档。生产缺少云端配置时拒绝运行，不会静默使用浏览器本地存储。原有 localStorage/IndexedDB adapter 只供开发和测试。

## 交付边界

云端上传、原子绑定、私有音频签名播放、运营认证、批量建签、重置/禁用、审计和失败对象定时回收已实现。Android 调试端支持 NDEF URI 写入、物理读回核验与失败上报恢复。

自动测试不替代实体 NFC、iPhone 权限和现场验收。正式收集前必须创建真实运营账号、确定保存期限。不要提交音频、密码或服务器密钥。

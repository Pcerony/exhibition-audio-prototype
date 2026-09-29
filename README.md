# 展览声音档案原型

一个用于体验 NFC 展签录音与运营流程的中日双语网页原型。

系统需求、架构、跨端 API、安全、路线图和 Agent 协作规则见 [`docs/README.md`](docs/README.md)。当前网站仍是浏览器本地存储原型；正式云端录音按 [`docs/PHASE_1_CLOUD_RECORDING.md`](docs/PHASE_1_CLOUD_RECORDING.md) 作为第一阶段建设。

网站界面支持简体中文和日语，可在页面右上角切换。手机预览：<https://voice.heisei.space/>。访客示例页：<https://voice.heisei.space/#/t/demo-001>。运营后台：<https://voice.heisei.space/#/admin>。

## 启动

```sh
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址。首页是 NFC 轻触说明；运营后台位于 `/#/admin`；示例访客页面为 `/#/t/demo-001`。录音需要在 `localhost` 或 HTTPS 页面中使用，并允许浏览器访问麦克风。

## 原型边界

- 展签状态保存在当前浏览器的 localStorage，录音文件保存在当前浏览器的 IndexedDB。
- 其他设备或浏览器看不到这些数据；清除浏览器数据会删除原型录音。
- NFC 芯片尚未实际写入网址；运营后台生成的网址可用于后续芯片写入试验。手机系统读取芯片中的网址并打开对应展签，网页本身不会在后台持续扫描 NFC。
- GitHub Pages 提供 HTTPS。可在 iPhone Safari 或 Chrome 中点击“开始录音”测试权限。若 Chrome 没有弹窗，先检查 iPhone「设置 > Chrome > 麦克风」是否开启，再检查 Chrome 地址栏左侧的网站权限；系统级权限关闭时，网页可能不会收到弹窗。
- 仓库和网站内容是公开的。不要录入敏感或私人音频。
- 当前没有 Supabase、云端上传、正式运营者登录或跨设备同步。多人并发与权限仍需在云端版本实现并验证。
- 展签 CSV 使用两列：`展签编号,批次`。批次可以留空。

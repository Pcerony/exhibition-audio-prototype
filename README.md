# 展览声音档案原型

一个用于体验 NFC 展签录音与运营流程的中日双语网页原型。

网站界面支持简体中文和日语，可在页面右上角切换。手机预览发布于 GitHub Pages：<https://pcerony.github.io/exhibition-audio-prototype/>。访客示例页：<https://pcerony.github.io/exhibition-audio-prototype/#/t/demo-001>。

## 启动

```sh
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址。运营后台位于 `/`；示例访客页面为 `/t/demo-001`。录音需要在 `localhost` 或 HTTPS 页面中使用，并允许浏览器访问麦克风。

## 原型边界

- 展签状态保存在当前浏览器的 localStorage，录音文件保存在当前浏览器的 IndexedDB。
- 其他设备或浏览器看不到这些数据；清除浏览器数据会删除原型录音。
- NFC 芯片尚未实际写入网址；运营后台生成的网址可用于后续芯片写入试验。
- GitHub Pages 提供 HTTPS，因此可在 iPhone Safari 中请求麦克风权限并测试录音。首次使用时，请允许 Safari 使用麦克风。
- 仓库和网站内容是公开的。不要录入敏感或私人音频。
- 当前没有 Supabase、云端上传、正式运营者登录或跨设备同步。多人并发与权限仍需在云端版本实现并验证。
- 展签 CSV 使用两列：`展签编号,批次`。批次可以留空。

# Google 地图接入准备

## 已确认体验

- NFC 打开对应卡片后，先选地点或跳过，再录音，最后填写可选昵称。
- 地图默认福冈市；支持地名搜索和拖动选点，不强制获取手机定位。
- 地点可选，不影响原有的一卡一录音、服务端原子绑定和私有音频规则。

## 云端配置（2026-10-15）

- 独立项目：`fukuoka-voice-maps-2026`，显示名称 `Fukuoka Voice Maps`。
- 已启用 Maps JavaScript API、Places API (New) 和 API Keys API。
- 已创建浏览器密钥资源 `visitor-maps-browser`，密钥值不写入文档或提交。
- API 限制仅允许 `maps-backend.googleapis.com` 和 `places.googleapis.com`。
- 网站限制：`https://voice.heisei.space/*`、`http://localhost:5173/*`、`http://127.0.0.1:5173/*`。
- 用户操作后已复查：`billingEnabled: true`，项目已关联已有结算账号。助手未代替用户确认付款或接受协议。

## 下一步

1. 已完成：负责人关联结算账号，命令行复查确认生效。
2. 配置 API 请求配额及预算提醒。预算提醒不是硬性费用上限，不承诺绝对零费用。
3. 实现地点数据契约、可跳过的选点页、录音流程和后台显示，再运行测试和双设备云端验证。
4. 接入前核对 Google Places 内容存储及署名规则；不默认允许永久保存所有搜索结果字段。

当前仅完成云端接入准备，未上线地图功能，未改动生产录音数据。

## 官方参考

- [价格](https://developers.google.com/maps/billing-and-pricing/pricing)
- [成本管理](https://developers.google.com/maps/billing-and-pricing/manage-costs)
- [Places 内容和署名政策](https://developers.google.com/maps/documentation/places/web-service/policies)

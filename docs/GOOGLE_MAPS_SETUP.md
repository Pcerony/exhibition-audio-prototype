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

## 开发进度（2026-10-16）

- 已实现 location DTO、前端 repository 传输及内存 adapter；迁移和 claim/public-tag 端点代码已接入，尚未部署。
- 搜索仅保存 place ID；Google 返回的地名和坐标不持久化。手动选点保存用户确认坐标。
- 本地前端73项测试通过，普通构建通过；后端2项Node及11项Deno测试通过。
- 独立 PostgreSQL 进程验证迁移、匿名 RPC 限制、地点约束及并发绑定只保留获胜地点。此为本地证据，不代表生产验收。
- 配额仍未配置；首次查询发现本机缺 gcloud beta 组件，命令在安装确认处退出，未更改配额。后续安装组件或使用正式 API 查询。
- 仍需地图页面、管理展示、费用保护、兼容发布与双浏览器验证。不能将当前进度称为地图已可用。

### 后续实现记录

- 选点组件和地图适配器已实现，访客页已接入先选地点/跳过再录音，支持返回修改、日中切换，昵称仍在录音后。
- 组件模拟测试及既有回归共76项通过，普通构建通过；真实 Google 地图尚未验证，不以模拟测试代替。
- 已安装 gcloud beta 组件，成功通过 `gcloud beta quotas info list` 读取 Places 实际配额。自动补全默认每日175000次，远高于小型展览需求，尚未下调。旧 `services quota` 命令不可用，应使用 `quotas`。
- 下一步仍需费用配额调整、真实地图配置与浏览器验收、后台地点展示和兼容发布。

### 已落地的配额保护与展示

- 已申请并获准：Maps 每日1000次、Places 自动补全每日3000次、Place Details 每日1000次；配额偏好均返回 grantedValue 与目标一致。Maps 实际 quotaInfo 复查为1000。
- 这是每日请求保护，不是月度费用封顶；多日使用仍可能超出免费额度。预算提醒尚未设置。
- 本地忽略的 `.env.local` 已接入受限浏览器密钥，不提交配置值。
- 后台认证列表接口增加地点元数据，网页后台和访客播放页增加 Google Maps 地点入口。前端77项测试、构建通过；管理接口10项Deno测试通过。
- 仍未生产部署，仍需真实地图测试、页面截图、完整发布兼容检查与双浏览器云端验收。

## 官方参考

- [价格](https://developers.google.com/maps/billing-and-pricing/pricing)
- [成本管理](https://developers.google.com/maps/billing-and-pricing/manage-costs)
- [Places 内容和署名政策](https://developers.google.com/maps/documentation/places/web-service/policies)

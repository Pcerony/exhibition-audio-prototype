# 73 块地图数据与坐标校准

## 来源和版本

- 拼装板轮廓取自 [福冈道路优先 73 块地图预览](https://github.com/Pcerony/fukuoka-city-model-preview/tree/a4270a1b2ee0a150997fde0d69fe1ca033e536a9) 的 `station_priority` 方案，只提取 73 个分块的闭合轮廓。固定上游提交 `a4270a1b2ee0a150997fde0d69fe1ca033e536a9`，源 HTML SHA-256 为 `ac6efa9aa3a8ae1f1f5aad60302a11d7c5bc6df208a5b07d3ad3a9d1999da8a1`。重建文件前须使用相同提交的 `index.html`，提取脚本会校验散列值。
- 应用数据版本为 `fukuoka-road-73-v13`。轮廓坐标以地图模型的局部毫米为单位，范围为 `1500 × 1320 mm`；这不是经纬度，也不能单独用于地点匹配。原预览显示 73 块、装配总览和 `0 / 0 mm²` 缺口/重叠；这些是模型预览自己的打印几何报告，不等同于地理配准验证或实体实测。
- 上游地图说明：数据源为福冈市 / 日本国土交通省 Project PLATEAU 的福冈市 2024 城市模型。PLATEAU 数据按其[网站政策](https://www.mlit.go.jp/plateau/site-policy/)使用并注明来源；本项目仅复用加工后的 73 个拼装板轮廓，未复制原始 CityGML、建筑、道路、河流或打印文件。来源项目的[加工与来源说明](https://github.com/Pcerony/fukuoka-city-model-preview/blob/a4270a1b2ee0a150997fde0d69fe1ca033e536a9/ATTRIBUTION.md)记载上游数据与加工事实。

## 经纬度换算状态

目前只确认了预览内 TENJIN、HAKATA 两个模型坐标锚点；它们不是独立的精度验收点。自动推算只有在本页补齐不同地点的独立核验、预期板号、地图叠加复核和误差记录后才能启用。没有通过该门槛时，列表应显示待核对，不能猜测板号。

手动落针仍按既有地点契约保存参观者提供的经纬度。Places 搜索的地点坐标只在当前选择和计算期间使用；数据库仍只保存 Place ID，不缓存 Places 返回的坐标、地址或名称。

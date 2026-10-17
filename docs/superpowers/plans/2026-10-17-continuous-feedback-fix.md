# 连续写卡与振动修复

## 根因与方案

当前发布3.1.1/code7。云端回报后才调用NfcAdapter.ignore，用户此时可能已移开芯片；官方API说明ignore返回false也可能表示标签已离场。现代码一律pauseWriting，形成每张卡后需要暂停/开始。修复为false时按已无当前标签处理，保留成功反馈停留及busy等待，再自动准备下一张。true时继续等移除回调，不用超时假装离场。普通/自动NDEF防覆盖仍作为第二道保护，已写的同一枚卡不能被下一任务覆盖。其他异常不推断已离场。

反馈目前只用View.performHapticFeedback，受触摸反馈设置与视图附着影响；增加成功事件的直接Vibrator反馈（有振动器且非静音/勿扰），失败不同节奏。沿用VIBRATE权限，不强行绕过系统勿扰，声音独立开关。

已有内容规则不改变：普通/自动拒绝其他URL/文本，原内容不写；相同目标URL可以重复核验，不清除云端录音；明确单张覆盖才替换NDEF，原云端录音不删除，已绑定目标仍只播放。只读/锁定/容量不足无法强写。FOREIGN_TAG提示引导先读卡核查，不默认开强制覆盖。

## 执行

- [x] 补SuccessGate测试：ignore false可推进、true等待回调、忙碌不丢推进、暂停取消；反馈模式与自动防覆盖回归。
- [x] MainActivity修复移除状态衔接，WriteFeedbackDialog加直接事件振动；版本3.1.2/code8。
- [x] Android53项JVM、构建/lint通过（0错误/5项既有警告），独立审查修正事件振动usage后复审无阻塞项。APK配置与原签名核验通过。
- [x] 更新安卓中文指南和单独验收记录，不改其他正在编辑的文档/访客文件或生产数据。
- [x] 发布3.1.2试用包，远端附件大小/SHA256与已核验本地APK一致。

实体两张连续写卡/成功振动仍需用户手机实测；无实体设备不声称已验收。来源：https://developer.android.com/reference/android/nfc/NfcAdapter#ignore(android.nfc.Tag,int,android.nfc.NfcAdapter.OnTagRemovedListener,android.os.Handler)

本次共享工作目录另有正在编辑的访客/地图/文档改动，未纳入安卓提交。运行当前工作目录前端测试为139通过/13失败（含超时及地图浮点断言），普通构建当时出现googleMaps.ts未提交改动的坐标类型错误；不声称全仓库回归通过，不改动或回退它们。安卓最终测试/构建独立通过，发行仅包含安卓与本轮专属指南；合并前以干净提交CI复验网页基线。

APK SHA256：`1f8e2110e2cca65f3c004321acab7ae78aea4c73a8950ab712944be20857eb5a`；签名沿用Android Debug证书 `48a52ba6a1cdc413f5ee828b11cd922a4604951299547b7cea37c2e901d04b3d`，无实体设备连接。

隔离发行提交 `ad2f9e8` 只包含9个安卓及专属说明文件，没有带入共享目录的其他任务改动。在独立归档中普通/Pages构建及2项Node+30项Deno通过；首次前端149项中146通过/3项异步等待或超时失败，保留记录并单线程复验，不掩盖该次失败。下载：`https://github.com/Pcerony/exhibition-audio-prototype/releases/download/v3.1.2-rc1/voice-writer-v3.1.2-candidate.apk`。

单线程复验 `npm test -- --run --maxWorkers=1 --testTimeout=30000 --retry=1` 最终149项全部通过，未改网页测试源文件。实体NFC和真实事件振动仍未验收。

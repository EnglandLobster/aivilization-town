# 家庭、住房、照护与健康

家庭：`households propose` 提出 family/guardianship/cohabitation 的原始条款，另一人必须独立 accept。任一方可结束已成立关系；共同居住须已有真实共同住所。监护链接表示双方同意的照护关系，不授予读记忆、花钱或修改他人状态的权限。
人口：`population self` 查询自己的权威生命周期事实。声明家庭不会生成孩子或年龄变化。

住房：`housing list` 查看住宅与容量；`housing choose/build/upgrade` 接入原有住房规则。
`leases offer` 只能提出分享自己当前真实住所的租约，不能宣称拥有公共住宅。对方实际到场并 accept 后，先期租金与押金原子结算；每天模拟时间自动支付约定租金，余额不足记录欠款，可 leases pay 补交。
任一方 leases end 或到期时返还押金；不会自动更改情感或强制驱赶/传送居民。维修请求用 civic request-help，费用与合作另需相应同意。

照护：接受照护者 `care request`，照护人 `care accept` 后在双方实际到场且空闲时 care start。双方时间被占用，达到结束时间才记为完成。文字不自动治疗身体。

健康：`life doctor` 是世界中的真实治疗。`health record` 追加本人或患者授权的原始病历、用药记录、复诊说明；treatment 需本人世界治疗事件 ID。
患者通过 health grant/revoke 授权或撤销其他人读取/记录；撤销立即生效。药物说明本身不产生药理效果，体征与治疗效果仍来自世界医疗规则。复诊可组合预约、提醒和真实治疗。
[租约](../commands/leases.md) · [关系](../commands/households.md) · [照护](../commands/care.md) · [病历](../commands/health.md) · [生活索引](index.md)

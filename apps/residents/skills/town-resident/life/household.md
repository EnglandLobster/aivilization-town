# 家庭、住房、照护与健康

家庭：`households propose` 提出 family/guardianship/cohabitation 的原始条款，另一人必须独立 accept。任一方可结束已成立关系；共同居住须已有真实共同住所。监护链接表示双方同意的照护关系，不授予读记忆、花钱或修改他人状态的权限。
人口：`population self` 查询自己的权威生命周期事实。声明家庭不会生成孩子或年龄变化。

住房：显式physical-housing-rest模式按本人实际位置和真实完工住宅结构结算休息，未建成/已拆除无住宅效果；实际磨损和维修影响未来恢复，过期许可或行政关闭不让仍存在的屋顶消失。`housing occupancy`展开实际来源和模型，旧个人服务上限保持原规则。不强制搬家或安排睡眠。显式occupancy模式的 `housing occupancy` 分开查询自己的登记住所、实际位置、物理可用性和当前使用权；`housing leave` 只退掉本人精确版本的住所登记，不传送、不退押金、不免租约债务、不改服务等级。许可到期不等于已搬出，也不会生成永久产权。合同结束和实际出行分别操作。`housing list` 查看住宅与容量；`housing choose/build/upgrade` 接入原有住房规则；显式housing-choice模式另提供 `housing standard/lower`。standard区分实际住所、个人历史服务等级、收费与旧欠费，lower只能本人降低已支持等级，不退款、免债或改建筑/租约，身体数值不会即时改写。未完成身体活动应通过其自身入口结束后再选择。显式public-housing模式允许用 `governance housing` 分页查阅完整初始公共住房收费与升级门槛，经现有提案、独立表决与执行修改；执行后生效。它保留已有欠费，未来欠费不会自动代你降级或免债；不修改私人租金、建筑或身体参数。
`leases offer` 只能提出分享自己当前真实住所的租约，不能宣称拥有公共住宅。对方实际到场并 accept 后，先期租金与押金原子结算；每天模拟时间自动支付约定租金，余额不足记录欠款，可 leases pay 补交。
任一方 leases end 或到期时返还押金；不会自动更改情感或强制驱赶/传送居民。维修请求用 civic request-help，费用与合作另需相应同意。

照护：接受照护者 `care request`，照护人 `care accept` 后在双方实际到场且空闲时 care start。双方时间被占用，达到结束时间才记为完成。文字不自动治疗身体。

健康：`life doctor` 是世界中的真实治疗。`health record` 追加本人或患者授权的原始病历、用药记录、复诊说明；treatment 需本人世界治疗事件 ID。
患者通过 health grant/revoke 授权或撤销其他人读取/记录；撤销立即生效。药物说明本身不产生药理效果，体征与治疗效果仍来自世界医疗规则。复诊可组合预约、提醒和真实治疗。
[租约](../commands/leases.md) · [关系](../commands/households.md) · [照护](../commands/care.md) · [病历](../commands/health.md) · [生活索引](index.md)

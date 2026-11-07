# 空间与设施的定期使用

permits rules 查询当前规则，permits list/read 分页查自己有权读取的约定和署名。permits access --building-id ID 只显示你在该建筑的权限；newUseUntil 是新增使用的授权边界，null 表示当前无已知时间限制。实际居住或取回物品可能仍允许进入，但不授予继续生产、投料或接待的权限。

当前建筑控制者 permits offer：buildingId/buildingRevision 绑定真实建筑，granteeKind/granteeId 指定受让主体，users 是实名使用人列表，scopes 从 entry、operate、store、reside 中选择，mode 为 shared 或 exclusive。填写 title/terms 原文和 startAt/endAt/acceptBy 模拟时间。entry 不包括经营、存入或迁入，其他 scope 同时允许进入。shared 不保证设备空闲，exclusive 只排除该用途与时段内冲突的新使用；entry 不能排他。

受让方 permits accept --id ID --expected-revision N 独立接受；此前报价没有使用效力。如果报价已绑定交易订单，改用 trades accept 同时接受权限并托管价格，不能绕过付款单独接受许可。双方可以 permits withdraw 撤回未接受报价。已接受的内容不能单方改写或取消，受让方可以 permits release 放弃未来使用，正在进行的真实工作须先本人结束。集体使用精确 collectives resource 决定执行；成员身份不代替集体同意，也不替别人开始劳动。

实际生产和服务的 until 必须在连续许可期间内。到期阻止新的受保护操作，保留已完成劳动、库存和实际居住事实。仍需用 stocks withdraw 取回物品，不能把进入取回当成继续投料的权限。控制权交接保留既有许可；有许可义务时不能关闭、拆除或改造其用途/设施。维护与物理损坏仍按真实规则发生。

当前许可本身不扣款。有偿许可须另外接通原子交易结算；普通文件写上租金不会自动扣款。旧实验由运行者 enable-premises-rights 显式启用空聚合，不补造产权。

有偿许可的 permits read 返回 provision：availableMs 为已提供的有效且物理可用的权限时间，unavailableMs 为期间建筑不可用的时间。无需到场才开始计费，但原文、满意与实际参加始终分开。房屋损坏不抹去此前提供的时间；维修后只累计以后的可用时间。提前释放或到期时，未提供部分退回，已提供部分仍由买方确认或双方处理争议。

[参数](../commands/permits.md) · [建筑](premises.md) · [共同决定](collectives.md)

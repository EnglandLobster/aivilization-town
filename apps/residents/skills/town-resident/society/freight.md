# 真实货运与保管

freight rules查载荷模型。每份登记物品数量占一个载荷单位，这不是公斤。普通随身库存与手提货物共同受限；车辆同时计算乘员随身物品与车载货物。vehicles read查真实车辆载荷及来源，授权驾驶不代表受托货物的保管权限。

发货者先把实物存在来源stocks，再materials reserve --consumer-domain logistics --consumer-id 未来货运ID --beneficiary-kind resident或collective --beneficiary-id 发货控制者。freight offer写原文条款、两端库存和地点、reservationId及revision、确切items、指定carrierId、可选vehicleId、独立付款账户、deliveryFee、returnFee、deadline。ID最长60字符；费用最多六位小数；托管额为两个费用的最大值。

接收库存控制者本人accept预留接收空间；付款控制者独立fund；指定承运人本人到来源、空闲且有足够载荷时load。被写入约定不等于同意劳动。手提使用travel go；车载使用vehicles drive --id 车辆 --destination-id 地点 --expected-revision 版本。所有移动都需要真实路径、时间、进入权限及容量。

到达后指定承运人deliver，物品进入目的库存，交付费支付并退余款。车载货物留在车上，人单独走到目的地不能交货。货物不会进入承运人的可消费库存。

未取货cancel释放材料和款项；已取货cancel或到期进入return-required，货物和款项保留。必须实际回原处并return才能按退回费结清。不能用文字“送达”、超时或关库存把责任抹掉。集体可精确决定offer/accept/fund/cancel，不能代替个人load/drive/deliver/return。

保管接续先查freight rules的handoff.enabled与支持范围。显式启用后，用freight handoff --id 货运ID --handoff-id 提议ID --action propose --next-carrier-id 本人接手者 --expires-at 截止时间，可选--vehicle-id；前保管人或发货控制者提议，原费用收款人不变。freight handoffs --id 货运ID分页查看精确提议版本。各方分别用--action consent --role source/recipient/payer/previous-carrier --expected-revision 提议版本同意，接手者本人用--action accept执行；--action withdraw撤回。这个版本是提议版本，不是货运版本。

停放货物须实际同址/闲置/载荷与驾驶许可均通过；退出者来源由系统核验，不是填写名字即可跳过同意。在途恢复尚未接通。集体须另行显式enable-collective-freight-custody，然后以collectives的resource决定绑定freight.handoff、货运ID和完整action/handoffId/role/expectedRevision等参数；只允许提议、同意或撤回，不能代人accept。消费后的同意是一份精确许可，接手时检查其原提议及当前章程版本，不重复消费。章程改版或整份提议撤回可使许可失效；原代表不获得永久撤回权，仍须当前精确集体决定。运行者enable-freight-custody显式升级旧journal，不新增资产、不重写manifest。提名使接手者可主动查看待处理约定，撤回/到期后失去这条邀请读取权；已查询原文可能仍在模型历史。

freight list/read/ledger只向获授权方提供约定与原始事实。默认上下文仅有入口，不会广播货单、账户或承运人其他行踪。旧实验enable-logistics等待未完旅程结束，不增加车辆或历史载荷；超载物品保留，可现场存入库存后继续出行。

[货运参数](../commands/freight.md) · [车辆](../commands/vehicles.md) · [材料](../commands/materials.md)

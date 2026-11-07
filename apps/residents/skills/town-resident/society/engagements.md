# 真实服务约定

先engagements models查公开效果、耗材和可归还工具，facilities分页查实际护理/教学位。普通人工服务只结算人时，不产生满意度。基础照护不是药物/手术；指导学习受教师知识上限约束且不颁学历；供餐确实消耗食品。

经营者用engagements offer提出不可变原文条款：controller、providerId、recipientId、付款与收入账户、pricePerHour、providerShareBps(0至10000)、maxDurationMs、startAt/endAt和模型。每小时价格最多六位小数；零价合法。约定ID最长60字符。供料者先在同地点stocks存实物并materials reserve --consumer-domain services --consumer-id 约定ID，独立确认受益控制者；offer的reservationRefs每个为保留ID@版本，可重复flag，没有材料时省略该flag。

recipient本人accept，资源才绑定；payer独立fund，实际最高费用进入托管。出资不授权身体。双方各自start --until 模拟毫秒，只占本人的时间；两人都实际开始才计重叠时长。真实工位/身体/地点不足明确拒绝。只预约、写评语或在文件中宣称完成没有效果。

本人leave或参与者/控制者cancel结束未来服务；已发生人时按累计金额结算分成，剩余托管退原付款账户，未消费材料与工具退原库存。消耗食品不会重新生成。截止、身体资源不足、设施失效都有实际终止记录。共同账户必须为已承诺的应收/退款保留空间，进入清结仍可收已有退款；集体只能通过精确collectives资源决定offer/fund/cancel，不能替人accept/start/leave。

list/read看自己获授权的约定，ledger分页看事实；只能读取自己的身体变化，付款人和经营者不能借账目窥探别人身体。默认上下文仅标志与engagements入口。旧实验enable-service-engagements不补种设施；真实建成设施可供使用。名称、组织与评价由居民决定，不能改写登记的效果模型。

[完整参数](../commands/engagements.md) · [材料](../commands/materials.md) · [设施](../commands/premises.md)

# 真实履约与交易

你自行决定价格、合作和原文质量标准。trades rules查询当前支持范围；trades list/read/ledger查看有权访问的订单、来源和原始收付回执。平台不会替你生成满意评价。

卖方先安排尚未开始的真实来源，再trades offer：sourceKind为freight、service或已启用v2中的permit，sourceId及sourceRevision绑定真实过程；填写payerSector/payerId、revenueSector/revenueId、amount、acceptBy、title、terms。两账户分别归买方和卖方控制。价格最多六位小数，一个来源只支持一份订单，不重复售卖同一事实。

货物先完成材料和货运约定，买方取目的库存的控制者。商品价格与承运费是两项独立条款。服务引用engagements，必须pricePerHour=0，由订单计价；买方取服务付款账户的控制者，可以为另一位居民购买服务。服务受益人仍须本人接受和参与。订单收入不自动变成劳动者工资。

买方trades accept按精确expectedRevision接受并托管金额，此前对应freight load和engagements start会拒绝。未接受前任一方trades withdraw取消报价；到期会记录失效。开始履约后，不能仅取消订单就拿回款项并让在途货物消失；先在所属货运/服务过程按权限中断或退回。

有偿许可先由建筑控制方 permits offer，再 trades offer --source-kind permit 绑定原始许可。trades accept 把付款、许可独立同意和供给记录一起提交；任一步失败都不生效。租用人仍可按原许可的规则 release，真实占有与已存物品不会因退款消失。

真实交付或服务结束会产生订单履约记录，也可trades observe读取证据。服务按实际重叠时长计算可结算金额，退回未履行部分。实际货物退回/取消才返还商品款，运输退回费另算。收到事实不表示满意：买方trades confirm释放余款；有争议用trades dispute --content 原文。

双方可trades propose-settlement --refund 金额 --content 条款，对方trades respond-settlement --accept true/false。所有操作绑定当前expectedRevision；提案后的新操作会使旧和解版本失效。卖方trades waive放弃尚未收到的款项。退款不自动回收已到货的物品，也不抹去已经发生的服务效果。

集体当事方使用collectives的精确resource决定执行trades操作；成员个人不能擅自扣共同账户。旧实验由运行者enable-evidence-trade显式启用，不重写旧orders或补造资产。旧实验的有偿许可需显式enable-paid-permits升级；不会给历史免费许可补造收费。产权交割和长期义务继续按所属能力支持范围查询。

[参数](../commands/trades.md) · [货运](freight.md) · [服务](engagements.md) · [共同决定](collectives.md)

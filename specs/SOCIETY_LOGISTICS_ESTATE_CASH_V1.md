# 货运原托管退款接续

状态：工程验收通过。9项针对、3350项全仓通过/1原跳过，lint、排序typecheck与worker及依赖build通过。证据见 `evidence/SOCIETY_LOGISTICS_ESTATE_CASH_2026-10-07.json`。该切片解决已出资主体退出后的原合同结算；承运人退出、在途停止、继任搬运、自然人口及全模式接入仍未完成。

## 根因与边界

真实货运约定由logistics持有，原托管款已不在付款人余额内。原实现能产生合法取消/退回退款事实，却在world.applyEscrowAccounting向已删除的agents[payer]记账，报invalid-escrow-agent-balance。已装载与未装载两种真实fixture均复现；不是缺资金，也不能通过恢复死者身体或放松普通账户授权修复。

logistics继续核验原合同、托管、费用和退回材料proof；materials继续拥有唯一货物保管与实际退回。world新增logisticsEstateAccounting来源端口，只允许已有funded/loaded/return-required合同的正向保管收入，禁止借此从退出者发起新扣款。原residentFinancialAccount与普通actor校验不放宽。

ResidentLogisticsCommitted增加可选estateCashBatch，复用resident-estate-gross-settlement-v1及economy已注册logistics来源。先验证拥有领域的原始交易与实物证据，再将逐笔原交易映射到原主体的保管账户，和货运、材料、共同账户一起回放。不净额化、不制造新钱；源版本、原合同修订、回执与交易序列必须完全一致。旧活居民事件不需此字段，解释不变；缺证明或重复回放拒绝。

## 可观察行为

- 未装载取消或到期：释放原材料承诺，原托管运费退原付款人的保管账户。
- 已装载取消：仍为return-required，货物与托管不动；本人实际在原地点退回后，支付约定退回费，其余回原付款人。
- 到期由system记录expire，不伪造原付款人的cancel。
- 死亡不授予承运权、不改变货物位置，不解除原承运责任。承运人退出仍须另行提供身体/位置/保管接续。

## 验证与交付

3项新增集成实例从真实offer/accept/fund和可选load开始，组合人口capture及取消/退回/到期；验证原款92→100或97、承运收入100→103、库存回到8、托管归零、供给守恒、原输入不变与确定性回放。缺失/篡改资金来源、重复事件、死者普通命令拒绝。原6项货运测试保留旧事件、出行、载荷、位置和到期语义。

这次没有新CLI、manifest默认值或每轮上下文。已有货运状态和行动回执继续作为感知入口；保管账户不是居民可随意提款的新工具。canonical世界未迁移，不以这些测试声称真实OpenCode或自发社会实验通过。

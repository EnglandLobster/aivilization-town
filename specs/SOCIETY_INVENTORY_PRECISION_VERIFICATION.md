# 实际库存数量请求验收

2026-10-05，`pnpm check`通过：2708项通过、1项跳过，383个测试文件通过、1个跳过。residents依赖构建通过。编译HTTP/CLI脚本`apps/residents/scripts/verify-inventory-precision.mjs`完成4次调用、1次预期的空库存拒绝；重开全状态相同，journal字节不变。

真实失败来源为自由160次实验序号1059；测试覆盖两次0.4赠送后的余量在食用、消费、再次赠送、AMM出售和外部出口中使用，报价/效果均按真实余量，零库存、实际不足和伪造精度记录拒绝。旧库存reducer继续严格扣减，没有重算旧事件。

新`inventory-request-precision-v1`为纯数量意图规则；发生修正的事件记录请求/原库存/实扣，新的开放manifest记录来源。CLI路由和Skill结构未变。旧实验仍保留原失败，未将回归脚本记为居民自主恢复。

首次定向测试的fixture漏设地点导致初始化失败，补全后5条实际路径通过；首次全仓检查发现两处lint错误，修复后完整重跑。CLI验证先修复可选worldEvents读取和schema/世界拒绝退出码区分，最终4调用结果通过，脚本另行lint通过。

企业服务财务领域的4项测试也在本次门禁中；它尚未接通服务、CLI和工资，不算整项完成。下一步继续服务经营/雇佣组合。机器记录见`evidence/SOCIETY_INVENTORY_PRECISION_2026-10-05.json`。

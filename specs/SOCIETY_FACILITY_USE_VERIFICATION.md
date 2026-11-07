# 真实设施占用验收（W01/W02，2026-10-05）

`premises-facility-use-v1`把已建建筑中的实际工作位、储物容量接入materials决策。规则公开为每物品数量单位占一个存储单位、每加工会话占一个工作位；名称、primaryUse和集体成员身份不授予容量。

- 同一地点所有stocks、未完加工托管投入、未来产物和外部保留的退回空间合并检查，不能拆库存绕过。空记录仍可创建，但零实际储量不能存入物品。
- 本人开始生产时同时检查身体时间、当前经营权限和真实空闲工位。有效会话持有工位；本人离开/完成释放，权限丧失停止后续工作但不没收个人库存或抹去已结算劳动。
- `stocks read`和`premises read`的facilityUse提供粗粒度物理容量、储存/未来产出预留总量及工作位占用，不公布其他库存的物品名单、来源或人员身份。
- 新manifest显式启用并记录版本。旧premises状态保持未启用；`enable-facility-use`检查既有货物和会话，超额返回原因，不削减货物或挤掉人。现有建筑条件恶化不会把保管中的货物变成不存在。
- 领域材料算法在materials、实体容量在premises，world装配只读容量/工作位端口；worker不复制容量公式。领域事件按原始版本重放。

验证：

- 新增4项worker集成测试覆盖跨库存总额、未来产物预留、跨居民工位争用和离开释放、拒绝超额升级后自行清结、外部供料退回空间、撤权后进度/财产保留、零容量空记录；生产与建设既有测试继续通过。
- `pnpm check`通过：lint、全仓typecheck、**2403通过/1跳过**，327测试文件通过/1跳过。
- `pnpm --filter @aivilization/residents... build`通过。
- `node apps/residents/scripts/verify-facility-use.mjs specs/evidence/SOCIETY_FACILITY_USE_2026-10-05.json`通过：**34次编译版CLI/HTTP调用，4次预期拒绝**。显式测试种子4居民、每人30Wood/5Iron Ingot、初始同处现有Site外部地点；材料仍从本人库存实际存入并保留。
- CLI实际建成一间包含工作位的residence，验证物理参数允许生产，与“工厂”名称/分类无关；随后验证总储量、未来产出预留、两人争用/交替、未绑定材料到期退回、撤权停止与取回本人财物。
- 独立journal重启状态相等、原始字节不变。没有模型调用，不是自发制度或自然经营出现的证据。

能力数仍293，54CLI组、87Skill页；catalog v19、Skill v18、rulebook v11同步manifest。护理/教学等实际服务供给、收费、报酬及身体效果仍由W03/W07继续完成；所有运行模式和真实多Agent/自由运行仍保留在R01/R02。

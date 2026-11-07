# B01 能力边界契约：工程验收

日期：2026-10-05。对应[总 Spec](AGENT_DRIVEN_SOCIETY_V1.md)与[能力账本](AGENT_DRIVEN_SOCIETY_CAPABILITY_CONTRACTS.md)B01；不代表全社会能力完成。

- 本阶段验收时的211项CLI逐项登记规则来源、状态归属、事实/陈述/同意/权限/解释、本人参与、委托资格、实际路由与写入范围。新命令缺契约、重名或孤立契约都会拒绝启动。
- 居民可分页 `town rules capabilities`，以 `town rules capability --name 名称` 读取当前契约、启用状态、参数和政策来源；不注入全部上下文，不授予新权限。
- CLI路由由worker目录与residents适配器共享一处映射；规则文字和权威公式仍分开。
- 所有居民命令在持久化前验证领域效果族；程序内部步骤也执行检查。原文/共同记录不能偷偷提交world资金或身体事件。读取回执仅允许读取事件，不能借读操作改变群成员。
- 这道检查保护应用层边界，不取代各领域对具体事件、金额、权限和物理效果的校验。

验证：新增4项测试；开放runtime既有50项通过；最终全仓2238项通过、1项既有跳过，304文件通过、1个跳过；lint、全仓typecheck、公开导出和residents依赖构建通过。真实编译CLI共22次调用覆盖目录、居民陈述/身体参与区别和原有委托执行、资金守恒、幂等与回放。

测试故意将一次真实付款的world事件塞入共享记录adapter，证明提交前拒绝，状态和journal长度不变；同时验证读取事件不能混入群组成员变更。目录也可在旧实验未启用协作模块时读取，但不能因此启用写能力。

代码：`apps/worker/src/openSociety/capabilityBoundaries.ts`、`ruleDefinitions.ts`、`capabilityRoutes.ts`、`rulebook.ts`、runtime/programExecution；回归：`capabilityBoundaries.test.ts`。CLI证据：[SOCIETY_BOUNDARIES_2026-10-05.json](evidence/SOCIETY_BOUNDARIES_2026-10-05.json)。本阶段未新增真实模型实验，完整多Agent及无剧情验收仍由R02承担。

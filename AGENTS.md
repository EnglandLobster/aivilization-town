# AIvilization Town 工程与架构约束

本文件适用于整个仓库。所有 AI Agent 和开发者在分析、设计、修改、测试或评审代码前，必须先遵守本文件。子目录如存在更具体的 `AGENTS.md`，其规则可以补充本文件；发生冲突时，以离目标文件最近的规则为准，但不得破坏这里定义的全局架构边界和数据一致性要求。

## 1. 核心目标

本项目是一个长期演进、事件驱动、AI-native 的社会与经济模拟系统。架构决策必须优先保障：

1. **正确性**：领域不变量、资金守恒、事件回放、模拟时间语义必须可证明。
2. **可维护性**：一个业务概念应有明确且唯一的归属，避免规则散落。
3. **可扩展性**：新增企业、市场、金融、治理、社会机制时，应通过稳定边界扩展，而不是继续扩大中心 switch 或共享状态。
4. **高内聚、低耦合**：同一领域规则聚合在一起；跨领域只通过明确的端口、命令、领域事件或集成事件协作。
5. **确定性与可回放性**：相同初始状态、事件和策略版本必须得到相同结果。
6. **兼容性**：已有事件流、快照、manifest 和公开 API 不得被无意破坏。
7. **可观测性**：重要决策、拒绝原因、策略版本和跨账户流动必须可审计。

不要把“快速把功能塞进去”视为完成。一个功能只有在领域归属、依赖方向、不变量、回放和测试都成立时才算完成。

## 2. DDD 使用原则

DDD 在本项目中用于保护复杂业务规则，不是为了制造目录、类或样板代码。

### 2.1 必须先确定业务归属

开始实现前，必须回答：

- 这个概念属于哪个 bounded context？
- 哪个聚合拥有它的状态？
- 哪个聚合负责维护它的不变量？
- 这是领域规则、应用编排、基础设施还是只读投影？
- 它产生领域事件还是跨上下文集成事件？
- 策略变化是否会改变历史事件的重放结果？

如果无法明确回答，不要直接向 `world`, `worker` 或大型 projection switch 增加逻辑。先定义边界。

### 2.2 聚合规则

- 聚合是事务一致性和业务不变量边界，不是任意数据集合。
- 聚合之外的代码不得直接发明聚合状态转换。
- 聚合对外优先暴露纯决策函数：`state + command + policy -> domain events | rejection`。
- 状态更新由统一的 domain event applier/reducer 完成。
- 一个命令需要修改多个聚合时，由应用层编排；不得为了方便把多个领域合并成巨型聚合。
- 聚合之间通过 ID 引用。除只读快照外，不应持有另一个聚合的完整可变对象。
- 聚合拒绝必须给出稳定、可测试、可审计的原因。

### 2.3 领域模型不能贫血化

如果一个实体存在状态机或重要不变量，例如企业偿付能力、股权、债务、招聘、住房等级，则相关规则必须位于所属领域模块，而不是全部堆在 handler 或 projection 中。

可以使用 TypeScript 数据类型和纯函数，不强制面向对象类。但必须保证：

- 状态结构、策略、决策函数和事件应用函数在同一领域边界内高内聚。
- 应用层只做授权、跨聚合读取、流程编排和事件映射。
- projection 只重建状态，不重新计算业务决策。

## 3. 当前 bounded contexts

### `@aivilization/sim-core`

拥有通用模拟原语：ID、命令/事件 envelope、时间、分区、事件存储基础能力。

- 不得依赖任何上层领域包。
- 不应包含企业、税收、住房等具体业务规则。
- 全局命令/事件类型注册可以放这里，但 payload 和业务语义属于对应领域或 `world` 集成层。

### `@aivilization/economy`

拥有经济基础原语和算法：

- 账户、复式交易和货币供给分类；
- Inventory 数学；
- AMM、价格、估值；
- 生产、配方与生产链；
- 外部市场流动性算法；
- 镇外贸易定价（滚动净出口平衡 + √balance 冲击，注入/销毁由 world 结算）。

这里不拥有 Agent、企业生命周期、政府或世界调度。API 应保持纯函数、无存储依赖、无 `world` 依赖。

### `@aivilization/enterprise`

拥有企业聚合及其生命周期：

- 企业现金、库存和经营累计；
- 所有权份额与留存收益；
- 员工成员关系和容量；
- 偿付能力、宽限期、破产、关闭；
- 可分配利润和分红规则。

企业领域不得依赖 `world`、worker、API、文件系统或数据库。业务决定返回领域事件，由 `world` 映射成持久化集成事件。

新增贷款时，不要默认把整个银行系统塞入 Enterprise。若存在贷款人、还款计划、抵押品和违约生命周期，应建立独立 credit/finance bounded context；Enterprise 只保留影响自身偿付能力的引用或义务。

### `@aivilization/credit`

拥有单一权威"镇银行"聚合及其信贷生命周期：

- 银行现金账户（流通账户）、存款台账（负债）与贷款账簿；
- 存款利率支付、贷款日结息、摊还自动扣款（先息后本）、missed-payment 计数与违约；
- 按信用记录演化的贷款额度（违约减半、还清加成、上下限 clamp）；
- 并发贷款上限与准备金约束（放款后银行现金 ≥ 存款总额 × reserveRatio）。

credit 领域为纯决策函数与领域事件，不得依赖 `world`、worker、API、文件系统或数据库。一切资金变动都是银行与 Agent 流通账户之间的 transfer，不得改变 moneySupply；银行初始准备金来自 scenario 种子 `initialBankReserves` 并计入种子 moneySupply。跨账户扣款（借款人余额读取与记账）由 `world` 应用层编排。

### `@aivilization/society`

拥有社会与家庭侧规则：生理、消费、生活方式、教育、职业资格、招聘、工资政策、税收、福利、住房（含区域地价指数定价）和公共预算决策。

- 纯规则放在这里。
- 不读取 WorldProjection，不负责事件持久化。
- 与企业或市场交互时返回决定或金额，由应用层完成账户转移。

### `@aivilization/memory`、`@aivilization/agent-runtime`、`@aivilization/llm`

- `memory` 拥有认知记录、检索、反思和长期画像。
- `agent-runtime` 拥有目标、计划、action synthesis、修复和 Agent 决策过程。
- `llm` 是模型提供方和结构化生成基础设施。
- Agent 的“想做什么”不能绕过 World/Domain 的权威校验。
- 决策上下文是只读模型，不得成为领域真相来源。

### `@aivilization/information` 与开放居民实验

- `information` 拥有信息空间、文件作者/权限/修订、消息收发，以及个人订阅、原文版本传播和个人已读记录的纯决策与事件应用。
- 传播只记录原文版本引用与作者原话；当前 ACL/撤下状态控制可见性。订阅通知按需读取，不自动扇出全文、唤醒或改写认知。
- 普通文件正文不能产生经济、产权或身体状态变更；个人认知不能改写经历事实。
- `apps/worker/src/openSociety` 编排信息、认知及现有 world 事件，使用独立单写入 journal。
- `apps/residents` 是 HTTP/CLI/OpenCode adapter；居民认证必须绑定身份，不能由模型传 actor ID。
- 居民操作统一经 `town` CLI；OpenCode 仅开放受限命令执行器，不暴露业务 MCP。Skill 为按需查阅的索引；原始公共文本不得被改写成指令。
- 开放居民模式不依赖候选动作生成器；默认上下文必须有界，更多信息由授权查询获取。
- 城市应用的 Wiki 仅索引原始文本与作者填写的元数据；禁止自动摘要、合并观点、生成共识、评分或推荐排名。预置指南属于 `content`，不预造居民投稿。
- 实验目录与 canonical daemon 分开；真实模型链路验收与无剧情自由运行分别报告，不能以模型文字代替事件证据。

### `@aivilization/collaboration`、`@aivilization/commerce`、`@aivilization/services`

- `collaboration` 拥有版本化多人提议、逐人同意和署名履行/争议声明；既有对话推断承诺保持 `world.socialCommitments` 的原有归属，不重复写入。
- `commerce` 拥有报价、订单、付款请求与押金的纯决策/事件；依赖 economy 会计原语。world 应用端口原子编排账户/库存与 commerce 事件。
- 订单托管现金属于 `public-service:resident-commerce` 流通账户，必须计入流通账户对账与经济构成；预留库存实际移出居民可用库存，释放时守恒。
- `services` 拥有容量时段、预约和队列；签到依赖真实地点与忙碌状态，由 world 记录参与时长或真实移动。课程评语不能自行制造教育分数。
- society 的居民租约、家庭关系、照护和授权病历各自使用独立聚合。world 编排租金/押金/居住事实；information 原文、医疗陈述不自动改变产权、体征或人格。
- 生活连续性 v2：information 维护实际分页群已读；memory 的 v2 活跃认知限额允许归档；services v2 记录 ended/实际时长，不能推断满意或完整履约；commerce 的版本化和解须对方独立同意。
- resident-natural-day-v1 仅为显式开放实验策略，按真实劳动时长计薪，canonical 与旧 manifest 不变。ResidentParticipationEnded 只释放对应活动预留，不绕过其他忙碌状态；居民可部分参与或离开。
- 服务供给 v3：services 拥有提供者时间与接待容量；enterprise 只读端口验证成员/经营状态，人员本人开始或离开，world 原子预留/释放真实时间。供给详情按需 CLI 查询；服务参与不自动变成工资、药效或学历。路线见 `specs/CS2_MECHANISM_MIGRATION_V1.md`。
- 当前新生活模块只在独立开放居民实验启用，尚未接入分区 authority 或 canonical planner。不要把实验 journal 的成功等同于跨分区支持。

### `@aivilization/world`

`world` 是服务器权威的应用与集成边界，负责：

- 命令分派和跨聚合编排；
- 身份、位置、忙碌状态等世界级授权；
- 领域事件到 durable world event 的映射；
- simulation time cadence 调度；
- 事件回放和组合 read projection。

`world` 不应继续吸收可以独立表达的领域算法。新增复杂领域时，应先创建/扩展领域包，然后在 `world` 建立 adapter。

### `@aivilization/observability` 与 apps

- `observability` 只负责指标、轨迹、报告和验证，不反向控制领域真相。
- `apps/worker` 负责运行时组装、调度、策略解析、Agent context adapter。
- `apps/api`、`apps/server`、`apps/web` 是输入输出或部署 adapter。
- apps 不得复制领域公式或通过 UI/LLM 直接修改 projection。

## 4. 依赖方向

依赖必须从外层指向内层。当前允许的核心方向：

```text
sim-core
├── content
├── credit
├── economy
├── llm
├── observability
└── society (also depends on content)

economy + sim-core
└── enterprise

credit + economy + enterprise + commerce + memory + sim-core + society
└── world

llm + memory + sim-core + society
└── agent-runtime

domain packages + world + agent-runtime
└── worker / server / API / web adapters
```

强制要求：

- 禁止 `economy`、`enterprise`、`credit`、`society` 依赖 `world`。
- 禁止任何 domain package 依赖 apps。
- 禁止通过相对路径跨 package 导入内部文件；使用公开 package export。
- 新依赖必须说明为什么现有端口无法满足，且不得形成循环依赖。
- 为共享类型新增依赖前，先判断类型应归属 `sim-core`、领域包还是集成层；不要建立无归属的 `common` 大杂烩。

## 5. 分层职责

### Domain 层

负责：

- 值对象和聚合状态；
- 领域策略和不变量；
- 决策函数；
- 领域事件；
- 领域状态机。

不得负责：文件 I/O、网络、定时器、全局 projection、事件序号、UI、LLM prompt。

### Application 层

负责：

- 查找参与命令的聚合；
- 调用领域决策；
- 跨聚合授权和流程协调；
- 将 domain event 映射成 integration event；
- 保证一个命令产生的事件序列是原子的。

不得重新实现领域公式或偷偷修正领域状态。

### Infrastructure / Adapter 层

负责：事件存储、快照、文件、HTTP、worker、LLM provider、进程与部署。

不得把存储格式或供应商 SDK 类型泄漏进领域模型。

### Projection / Read Model

负责从事件确定性地重建查询状态。

- reducer 不得调用随机数、当前系统时间或外部服务。
- reducer 不得决定“是否应该发生”；这个决定必须已记录在事件中。
- 大型 projection 必须按 bounded context 拆为 reducer，并由组合入口调用。
- read model 可以为查询冗余数据，但不得成为写模型的不变量来源。

## 6. 命令、事件与时间语义

- Command 表示意图，Event 表示已经发生的事实。
- Event 名称使用过去式，payload 包含回放所需的最终事实。
- 历史事件不可改变语义；若新规则影响重放结果，应增加 policy/event schema 版本或兼容分支。
- 新字段优先设计为可兼容的 optional 字段，并为旧快照提供明确 normalization。
- 不得依赖 `Date.now()` 决定模拟领域结果；使用 simulation clock。
- 随机决策必须使用确定性种子，种子输入需要稳定并可审计。
- 跨越多个 cadence 的时间推进必须逐个补算非线性、概率性或有状态效果。
- 只有严格可加的效果才允许合并计算；必须有等价性测试。
- cadence scheduler 只负责枚举边界并调用领域决策，不承载领域公式。

## 7. 经济与会计不变量

任何余额变化必须属于以下之一：

1. 国内账户之间的转移；
2. monetary authority 注入；
3. 向非流通账户销毁/移出；
4. market/external 账户与国内流通账户之间的交换。

实现要求：

- 新资金流必须使用 `@aivilization/economy` 的 `AccountingTransaction` 或等价的平衡 entries。
- 普通复式交易 entries 合计必须为零。
- `moneySupply` 是流通账户的投影，不是可以任意增减的业务变量。
- 税、企业工资、分红、国库补贴和公共预算是账户转移，不改变总货币供给。
- 铸币、销毁、市场储备进出和外部部门流动必须明确标注 counterpart sector。
- 不允许只修改收款方余额而没有付款方、铸币账户或销毁账户。
- 企业现金、库存、员工、留存收益等只能通过企业领域事件变化。
- 金额、数量和份额必须验证 finite、范围和非负/正数约束。

## 8. 策略和配置

- 可调业务规则必须通过版本化 policy 表达，不散落 magic number。
- policy 必须有验证函数。
- 改变结算语义时必须提升 policyVersion。
- worker 中的 canonical policy 必须同步：runtime policy、manifest parameters、policyVersions 和 provenance registry。
- 实验功能与 canonical 默认值必须明确区分。
- 领域代码不得直接读取环境变量；由 composition root 解析后注入。

## 9. 高内聚、低耦合的代码尺度约束

出现以下信号时必须优先拆分，而不是继续追加：

- 一个文件同时实现多个 bounded context 的规则；
- 一个 switch 持续吸收不同领域的事件或命令；
- 一个 handler 同时做解析、授权、领域计算、持久化和 read model 更新；
- 为实现一个功能需要修改大量无关包；
- 同一公式或状态判断在两个以上位置重复；
- projection reducer 开始包含“应该不应该发生”的判断；
- 类型名称使用 `Manager`、`Helper`、`Utils`、`Common`，但无法说明单一职责；
- 为避免循环依赖把领域类型搬进一个无语义的共享包。

拆分时优先按业务能力，而不是按技术类型。推荐：

```text
domain-package/
├── model.ts       # aggregate/value objects
├── policy.ts      # versioned rules and validation
├── aggregate.ts   # decisions and event application
├── lifecycle.ts   # domain lifecycle decisions
├── ports.ts       # only when an external capability is truly required
└── *.test.ts      # invariant and state-machine tests
```

该结构是指导而非机械要求；小型纯算法不需要人为拆成五个文件。

## 10. 可扩展性设计要求

新增机制时优先使用以下扩展点：

- 新策略：新增 versioned policy，而不是修改常量。
- 新生命周期：新增 domain decision/event，再由 scheduler adapter 调用。
- 新资金流：新增 balanced accounting transaction 和集成事件。
- 新查询信息：新增 read projection/context adapter，不污染写模型。
- 新外部能力：定义 domain/application port，在 apps 中实现 adapter。
- 新 bounded context：创建独立 package，公开最小 API，并建立单向依赖。

避免“为未来可能需要”设计过度抽象。抽象必须至少满足一项：

- 保护真实业务不变量；
- 隔离明确变化轴；
- 阻止不允许的依赖；
- 支持两个以上真实实现；
- 形成可独立测试的领域边界。

## 11. 测试要求

每个新增或改变的领域行为必须至少覆盖：

- accepted path；
- rejected path；
- 边界值；
- domain event replay；
- 旧事件/旧快照兼容（如果涉及持久状态）；
- 跨聚合原子效果；
- moneySupply/库存等守恒不变量；
- cadence 跨多周期的等价行为；
- 确定性随机重放（如果涉及概率）。

测试层次：

1. Domain unit test：最快、最细，固定不变量和状态机。
2. World integration test：固定跨聚合事件序列和账户变化。
3. Worker/runtime test：固定策略组装、manifest、authority 和 Agent context。
4. Repository regression：`lint`、全仓 typecheck、全仓 tests、必要时 build。

不得仅以 snapshot 测试代替业务断言。关键余额、状态、事件顺序和拒绝原因必须明确断言。

## 12. 兼容性与迁移

- 默认保留已有公开命令和事件语义。
- 删除或重命名公开类型前，先搜索所有 package、apps、测试、文档和持久化样本。
- 快照新增字段时提供 hydration/normalization 默认值。
- 旧事件无法表达新语义时，使用 schema/policy version 分支，不得静默猜测。
- 迁移脚本必须幂等、可审计、可回滚或有恢复方案。
- authority、partition 和 local runtime 的 projection 必须使用同一领域语义。

## 13. AI Agent 实施流程

处理非平凡功能时，AI 必须：

1. 搜索相关类型、命令、事件、策略、projection、测试和 manifest。
2. 明确 bounded context、聚合和依赖方向。
3. 先在领域层实现并测试决策与不变量。
4. 再实现 world application adapter 和 integration event。
5. 再更新 projection/read model 和 Agent context。
6. 同步策略版本、manifest、注册表和文档。
7. 搜索遗漏的 exhaustive switch、allowlist、serializer、hydration 和跨分区路径。
8. 运行格式化、lint、相关测试、全仓 typecheck 和全仓测试。
9. 汇报行为变化、兼容性、验证结果和仍然存在的真实限制。

如果请求只是诊断或评审，不要未经授权直接实施大规模重构；但必须指出违反本文件的结构性问题。

## 14. 禁止模式

- 禁止在 apps 中复制领域公式。
- 禁止让 LLM 输出直接成为权威状态变更。
- 禁止直接修改 projection 来绕过 command/event。
- 禁止在 reducer 中读取 wall clock、随机数、网络或文件。
- 禁止用一个万能 `WorldService`、`EconomyManager` 或 `utils.ts` 承担多个领域。
- 禁止通过 `as unknown as` 掩盖领域类型错误，除非是在经过验证的 envelope 边界，且有说明。
- 禁止把 `undefined` 显式传给 exact optional property，使用条件展开。
- 禁止忽略区域市场可见性，Agent 估值和决策必须使用其实际可交易市场。
- 禁止把概率或有状态的多 cadence 效果合并为单次评估。
- 禁止无版本地改变持久事件的解释。
- 禁止为通过测试而削弱领域不变量或静默吞掉错误。

## 15. Definition of Done

一项涉及架构或领域行为的工作只有同时满足以下条件才完成：

- 领域归属和聚合边界明确；
- 依赖方向无反转、无循环；
- 领域不变量集中且有测试；
- 跨领域流程由应用层编排；
- 事件可确定性回放；
- 资金和库存变化满足守恒规则；
- 策略已版本化并进入 manifest/registry（如适用）；
- Agent read context 与权威结算使用一致的数据来源；
- 旧事件和快照兼容或已有明确迁移；
- `pnpm lint` 通过；
- `pnpm -r --sort typecheck` 通过；
- `pnpm test` 通过；
- 涉及 package/public export 时，相关 build 通过；
- 架构文档与实际代码一致。

涉及 Agent 可感知机制时，还必须明确：

- **感知**：机制通过 context 字段、记忆通道或要闻中的哪一种进入市民认知；若刻意不可见，说明原因。
- **行动**：市民能否作用于该机制；若不能，相关命令必须有明确的接入计划或休眠决断。
- **预算与阶段可见性**：新增上下文段必须定义上限、排序、剪枝以及哪些 planning stage 能看到它；不得默认向所有 LLM 调用注入完整上下文。
- **交付方式**：新增能力必须按 `specs/RESIDENT_CONTEXT_DELIVERY.md` 区分常态预览、主动 CLI 查询、行动回执与供应商会话历史；给出真实可用的展开入口。不得因复用完整决策模型而隐式扩大每轮注入。存入记忆不等于每轮自动召回，未再次注入也不等于已从模型历史中删除。

## 16. 相关架构文档

- `docs/ECONOMY_DDD_ARCHITECTURE.md`：经济、企业、会计和 world integration 的详细边界。
- `docs/reports/CS2_VS_OUR_ECONOMY_COMPARISON.md`：当前经济能力、差距与演进方向。

若代码与文档冲突，应先确认是实现偏离还是文档过期，然后在同一变更中修正，不能长期保留两套真相。

### 居民出行领域

`@aivilization/mobility` 拥有车辆/驾驶授权、司机登记、报价和行程状态机；world 原子编排真实共同行程与 commerce 托管。`ride-deposit-` 是出行专用托管命名空间，公共押金命令不得绕过行程结算。新 continuity 开放实验显式播种有限车辆，旧 manifest 不补造资产；初始车不是历史购买。车辆位置只通过有司机的实际旅行变化。新功能尚未接入 canonical planner/分区 authority。

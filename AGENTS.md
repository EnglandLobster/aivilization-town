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
└── society (also depends on content and economy integer-allocation primitives)

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

### 居民实际学习

`society.elapsedStudy`拥有版本化实际学习过程和整数累计分配；world原子编排身体时间、学习积累与`public-service:resident-study`流通托管。开始不发未来知识，停止退未用学费给原本人/国库。现行首条迁移只支持无耗材初始课程，来源明确为场景/外部，初始义务教育资助不冒充居民公共采购授权或真实教师。正式等级在记录的固定cadence、实际学习之后核定；居民教学仍归services。旧事件不改解释，启用须无旧预付活动且已启用实际睡眠；canonical/分区接入仍未完成。

### 居民出行领域

`@aivilization/mobility` 拥有车辆/驾驶授权、司机登记、报价和行程状态机；world 原子编排真实共同行程与 commerce 托管。`ride-deposit-` 是出行专用托管命名空间，公共押金命令不得绕过行程结算。新 continuity 开放实验显式播种有限车辆，旧 manifest 不补造资产；初始车不是历史购买。车辆位置只通过有司机的实际旅行变化。新功能尚未接入 canonical planner/分区 authority。

### Agent 驱动社会元能力

遵循 `specs/AGENT_DRIVEN_SOCIETY_V1.md` 的规则来源/修改权/执行权分离。information 拥有 shared records（当前 ACL、实际作者、版本与双方确认交接）；记录值均为居民陈述，不能成为第二份经济/产权账本。collaboration 拥有 programs、精确版本 mandates、有限 schedules 和执行记录，不依赖 world。开放 worker 通过现有公开 domain/world 端口在一个 journal 原子编排步骤；不能直接修改 projection 或在 reducer 中重跑流程。

程序仅能执行显式白名单，逐主体独立授权、指定 runner、限次限期且可撤回；程序修订不能继承旧同意。委托消息/编辑必须同时保留真实执行者与授权人，不能伪造本人操作。自然语言章程不直接获得扣款或公共治理权。新能力由可选 societyKernelPolicy 启用，旧 manifest 不隐式升级。新授权、记录和流程正文按需查询，不广播进所有居民上下文；真实执行结果不等于主观履约或自然社会涌现。

### 居民数据应用与集体程序

information 的 resident-record-views-v1 只计算当前双重ACL允许的共享记录；居民自定排序/聚合不得进入平台声誉、余额或投票资格。collaboration 的 resident-collectives-v1 拥有独立加入、冻结表决与精确执行凭据；修改章程使用旧程序，新加入者本人确认。通过声明不产生资源效果；真实资源adapter必须与凭据消费原子提交。退出使未来权限失效但不抹资产/义务，不得自动降低门槛或指定继任。开放居民journal为现有接入路径，旧manifest仅通过显式启用事件升级。

### 真实共同账户

economy commonAccounts 拥有真实现金、controlVersion、入资和清算状态；collective 是独立流通会计部门。world 原子协调外部余额与企业领域事件，开放居民应用把资金事件和集体决定消费一起提交。贡献不产生股权/债权/投票资格，负责人无快捷提款权。新增订单/债务/场所预留使用该账户前必须接入真实义务查询，关闭不得忽略未清偿资源；当前仅账户切片通过验收，整体资源清算仍在完整Spec范围。

### 资源控制原语

`@aivilization/authority`拥有个人/集体控制引用、精确版本的交接提议与独立接受，纯函数且不依赖information、collaboration、world或apps。information等资源领域可以单向依赖authority；资源本体/ACL/原文/义务仍由原领域持有。当前已接入的信息space/register/view的可选control优先于旧ownerId授权；旧ownerId不能成为永久后门。当前使用权限独立于控制，集体成员不隐含获得私人正文。worker collectiveResources统一验证精确集体决定、调用所属资源端口、原子消费证明，不伪造居民ID执行集体操作。群组、服务、车辆、设施、企业和整体清算还须分别接入，不把信息资源控制等同于全部资产清算。

### 通信群共同控制

information的可选resident-group-control-v1把群组控制、个人成员资格与消息作者分开。只有精确集体决定可代表集体管理；接管不自动入群或读消息。邀请接受和加入申请撤回必须本人操作，交接/关闭终止未决申请时记录实际原因与执行者。旧manifest必须显式enable-group-control，已有群组不补造同意或重写历史。

### 实物保管与生产

`@aivilization/materials`拥有地点化库存、生产订单、托管材料、实际劳动进度与生产回执；单向依赖authority和economy，不依赖world/apps。world原子编排实际居民库存、独占工作时间及体力，ResidentMaterialsCommitted携带可验证逐物品流转和注册转换。文本产品名不能改变物理属性，空库存记录不建造仓库或取得土地。

`resident-extraction-v1`显式启用有限场景原料源及真实采集，源预留不是私人可用库存；实际劳动才产生可用物，取消/24小时预留到期只退未取得部分。源容量与室内工位分开，不同时启用旧再生池；新模式禁止个人/企业旧即时生产，旧事件保持兼容。原料源开放使用来自场景，不虚构居民所有权，企业真实生产与全模式接入仍需补齐。

本人开始/离开生产，不得由集体程序代替；集体取料必须绑定实际领取人并由其现场执行。未消耗原料可退回，已完成产出/实际体力不回滚。新运输、服务、建设接入库存前必须登记占用/结算义务；不能沿用当前无外部义务端口来关闭已被占用的库存。新材料模块当前接入开放实验，canonical/分区接入及完整W01/W02后续能力仍在总交付范围。

### 真实土地使用与建设

`@aivilization/premises`拥有有限Site、不可变工程蓝图/进度、实体建筑/损耗/使用权限/残料。依赖authority、materials、economy公开端口，不依赖world/apps。物理模型与public-construction-use-v1初始土地制度分开；居民文件不能造地。材料保留绑定明确consumer和beneficiary，供料与工程接收独立授权；world在ResidentPremisesCommitted中原子校验材料证据、实际劳动/忙碌、建筑和新空间事实。

新建筑不使用旧“走进住宅即居住”的兼容推断，进入/经营/居住分别校验；既有义务不因控制转移而消失。拆除残料仍有来源和控制者，全部领取后才释放占地。工作在Site外部完成，参与者本人开始/离开；集体不能强制劳动。显式enable-premises不补造旧场景土地，带sourceId的register-construction-site是运行者迁移。细分设施占用、服务实际效果及canonical/分区接入仍按完整Spec继续，不以实验成功冒充全模式交付。

`premises-facility-use-v1`以显式策略启用跨库存合计储量、退料/未来产物预留及真实工作位。materials算法通过world只读端口获取premises容量；普通CLI不能更改容量。旧状态启用前检查既有库存和会话，不削掉资产或劳动。策略和是否启用必须在manifest/主动查询中可见。

### 真实居民服务履约

`services` 的ServiceEngagement聚合拥有不可变约定、本人接受/参与、付款托管与实际重叠时长；既有预约不自动变成身体同意。`society` 拥有登记身体/学习效果，`materials` 拥有真实消耗与可归还工具，`premises` 拥有实际医教位和显式初始设施来源。`world` 原子结算ServiceEngagement、公共服务托管、个人/共同账户、材料和独占时间；`public-service:resident-service-engagements` 必须计入流通对账。共同账户退款/应收空间要预留，有已付款约定不得关闭；settling可收旧收入退款。集体只可精确授权offer/fund/cancel，不能代人accept/start/leave。登记的基础照护不代表药物/手术，教育分数不代表证书。新manifest显式启用，旧实验不补造设施；当前仍需按R01完成canonical与分区路径。

### 真实货运与在途保管

`@aivilization/logistics` 拥有原文不可变货运约定、独立收货/付款与本人承运、费用托管和交付/退回责任。materials 拥有唯一实物 custody、来源退回空间和目的接收空间；logistics 不复制库存和车辆位置。world 原子验证物流事件、材料 proof 与平衡账户流，货运托管属于流通账户。mobility 的本人单独驾车、接客、载客共享载荷及保管权限端口；普通背包也计入载荷。取货后到期/取消必须保留物品和资金直到真实退回，不能瞬移、抹账或把受托货物变成个人消费库存。服务/货运共同账户的退款与应收空间统一预留。新车辆载荷是显式种子事实，旧manifest不补造。当前仍在开放实验，订单/企业/公共采购和canonical/分区整合须另外验收。

### 事实订单领域

`@aivilization/commerce` 的 `resident-evidence-trade-v1` 聚合拥有一次绑定的货运/实际服务订单、独立接受、托管、客观履约记录及双方和解；旧 `resident-commerce-v1` 事件不重解释。world 只读所属领域事实，禁止以事件自身的声明充当证明；收付走 `public-service:resident-evidence-trade` 并纳入流通账户对账。未接受订单限制关联装载/服务开始，途中取消不抹除实物与托管。服务订单只接入原服务时薪为零的独立计价路径，实际时长决定未履行退款，不制造满意或工资。

集体交易执行必须绑定本次代表的 controller，不能混用执行者个人身份。共同账户保留退款/收入容量与未结义务。新模块目前仍在独立开放居民实验，产权/使用许可、长期义务、经营采购与全运行模式接入继续按 `specs/SOCIETY_TRADE_AND_OBLIGATIONS_V1.md` 实施。

### 定期空间使用权

premises 的 `resident-premises-rights-v1` 拥有定期许可、用途范围、实名使用人、共享/排他时段及独立接受；world 的 `premisesRights` 是该聚合的组合投影。使用许可不是建筑控制、公共土地所有权、实际占有或本人参与。接受时重新验证控制版本、其他已接受许可、租约、库存和劳动义务；许可随建筑控制交接保留。普通 ACL 修改不能撤销已接受的许可，关闭/拆改须处理未到期义务。

实际生产/服务开始时检查完整授权区间；到期结算须保留真实已完成劳动，不得以当前到期状态否认历史时间。取回库存和履行保管返还允许有限进入，但不能据此新增生产、存放或租约。实物及实际居住仍归原领域，不能因许可到期自动消失。收费许可、有偿控制权交割及长期义务仍按总 Spec 继续接通；当前开放实验成功不表示 canonical 或分区已接入。

### 有偿定期许可

`premises-provision-v1` 在 premises 内记录已接受许可的可用/不可用区间。world 在建筑变化及许可结束前结清过去区间，依据实际提交前建筑版本，不能用维修后的状态倒算历史。只能由 `resident-evidence-trade-v2` 的原子接受同时启动付款、许可同意和供给记录；独立计量事件不能创建收费关系。commerce 只计算记录时间的价格，不把到场或满意当成许可供给。旧 v1 通过显式升级事件接通，旧免费许可不补造收费；共同账户 v2 仍使用既有实际托管账户。新增能力仍在开放实验 journal，全模式接入与独立 Agent 验收继续。

### 有序授权程序与控制交换

collaboration 的 `resident-program-actions-v2` 拥有封闭动作定义及逐步 principal/executor/mandate 证据。资源控制仍由各自领域拥有，程序不得直接改 ownerId、控制身体、替人投票或调用任意宿主命令。`ProgramRun.execution` 绑定原始动作与实际事件指纹；成功步骤和授权次数必须同一提交，失败不留下局部领域效果。资源权属与历史作者、成员、库存、地点及第三人权利分别处理。

开放 journal 的 `ordered-society-effects-v1` 引用完整事件序列；schedule、reaction 和时间推进合并必须保留跨领域顺序及全部事件族。不得按 family 重新排序或在追加反应时遗失引用。回放机械验证原授权/动作/效果的对应，再由所属 reducer 应用最终事实，不调用实时 action adapter。旧无此版本的 manifest/程序/journal 保持原义，启用是明确系统迁移。当前六类个人资源在开放实验接通；service、车辆、企业、集体组合及全模式仍按总 Spec 补齐。

### 开放居民服务控制

services 的显式 `resident-service-control-v1` 将目录管理与实际 provider 分开；要求 v3 实际供给记录。历史 owner 是原作者，管理权限读当前控制；交接保留预约、时段和本人出勤。旧v1个人服务控制可通过独立授权程序与付款原子组合，旧企业绑定拒绝保持原义。新v2组织控制另见下段，旧 manifest 不自动启用。工程证据见 `specs/SOCIETY_SERVICE_CONTROL_VERIFICATION.md`；真实自主采用必须另验。

可选`resident-service-principals-v2`由services唯一目录聚合维护controller、具名供给与版本；world使用实际ServicesState只读端口校验真实权源，开放组合journal只应用一次。公共辖域独立扩展，集体/公共精确决定与目录效果原子消费；普通servicesEvents不能冒充新组织管理事件。旧owner仍是原作者，enterpriseId是原供给关联，转移需独立关联证明，不能把经理签名当另一方同意。管理员不是提供者，本人开始/离开出勤；活跃提供者不可撤权，未结预约/队列/出勤不可关闭。企业现金/资本关闭必须查询实际目录资产与供给义务，缺少端口拒绝。公共原文查询不输出授权全文，集体成员不自动获得私人预约。直接组织创建、重开、多执行者关联授权、原组织收费/工资、整体退出及canonical/分区继续按完整Spec实现。

### 显式实际睡眠

`society`拥有`resident-rest-v1`会话和`resident-elapsed-physiology-v1`同时速率积分；world只编排真实时间边界、个人预留和事件。开放居民必须显式启用，旧预付活动结束前不得迁移；`town life wake`只允许本人按当前修订终止对应睡眠。默认上下文至多一个本人活跃会话。生命周期/迁移/amortization/旧共享概率cadence组合目前拒绝启用，canonical planner与分区authority仍待接入，不能默认为全模式完成。

### 居民公共程序

`@aivilization/governance`拥有显式辖域来源、资格/程序版本、精确提案、本人投票、程序结果、一次执行和异议/未使用决定的撤销。它单向依赖society的政策类型与校验，不持有财政账本。world用单个`ResidentPublicGovernanceCommitted`原子绑定公共授权消费和既有`world.governance`真实政策变化；重放不重新投票或按当前公式修改历史。

新模式显式启用，旧topic请愿不得旁路；initial majority/grant必须标为场景初始制度，不称居民共识。居民修改程序按旧程序通过，旧快照保留，未执行旧权限被新修订替代。常态最多3条有界提案入口；政治原文与个人表态按需查询。当前仅独立开放实验，招聘/住房/公共采购/完整补救及跨分区仍待接入。

### 公共程序与真实采购

`@aivilization/governance`只拥有明确辖域、版本程序、逐人表态、一次执行及署名异议。已生效税/预算/补贴继续归`world.governance`的原society领域。`resident-public-procurement-v1`是显式场景扩展，不可由私人程序扩权；国库只作为services付款账户，不是假collective/controller。`ResidentPublicGovernanceCommitted`原子绑定公共决定消费与精确服务托管，独立服务命令不能扣国库。services仍拥有本人接受、实际出勤、时间/材料结算和未用款退国库；公开采购账目不公开他人身体。该模式以operator来源明确停用抽象自动预算，保留已生效国库保留额度，采购不能双重产生抽象质量。旧manifest不自动迁移，canonical/分区仍待完整接入。

### 公共实际物品采购

`resident-public-goods-procurement-v1`显式扩展governance范围与commerce公共资金模式。买方先独立接受，精确公共决定原子完成`fund-goods`；执行者不能冒充买方。logistics拥有真实承运与返还，commerce拥有托管、独立验收和争议；退款回原国库。公共付款不改变命名目的库存的私人/集体归属，不能伪造公共collective/controller。只有公开订单及关联货运扩大查询范围，其他库存/订单ACL不变。公共产权、设施/建设采购、长期补救、canonical/分区继续独立验收，不把该实物链等同完整G03。

### 实际企业劳动与个人工资债权

`enterprise`拥有可选、显式启用的个人已赚工资账簿，`society`拥有实际劳动时间/身体过程。world原子编排实际时长、工资债权、个人净收入/国库税及本人时间释放。工资报价与计税周期在开始时冻结；固定边界结算后才运行企业生命周期。旧未归属欠薪原值保留，不允许被下一员工领取；离职/解雇/破产保留已赚债权，未付工资或活跃劳动阻止分红与破坏性关闭。新模式禁止旧总额工资事件绕过个人账簿。初始公共工资、实际生产/服务与计薪共用一次时间、共同控制及canonical/分区接入仍待补全，不把有偿时间等同真实产出。

### 实际生产与雇佣组合

`resident-productive-employment-v1`显式启用后，enterprise拥有真实生产任务付款授权/合同工资，materials拥有库存/工位/本人参与及实际工时收据，society拥有同时身体速率。world在同一材料事件中绑定身体、物质进度、个人工资与税。任务创建者须分别拥有材料控制和企业付款权；员工本人开始，不远程制造出勤。生产计薪不再另占AgentWork时间，付款不自动改变仓库产权。实际耗尽时刻释放身体，缺现金逐人保债；退出/解雇原子停止未来参与。旧活跃生产结束前不得迁移。初始清算顺序明确记录；服务计薪、共同企业控制、公共工资及canonical/分区仍未完成。

### 学习与制度资格

`resident-education-authority-v1`仅为显式开放居民模式。society拥有一次性初始资格确认，world将`educationLevel`作为唯一当前正式等级并记录不可变来源；学习积分不再反复派生正式学历。初始场景认可、已有正式记录、历史分数派生保留和注册初始认可必须分开；迁移不补造考试，也不暗中降级。非义务晋级须引用已记录的真实录取，义务晋级沿固定时间边界。制度政策随显式启用事件冻结，不能更换引擎就改变资格解释。未接入分区迁移，不能默许无来源的迁入；原文证书与课程评语仍不制造正式资格。

### 双方服务与连续身体

`resident-service-time-v1`显式冻结`resident-service-physiology-v2`及自然变化参数。society同时积分服务努力/效果与自然变化；services拥有实际服务收据、费用和耗材；world在普通身体路径前原子结算具名双方并跳过重复消耗。等待无服务效果，实际耗尽时释放双方，剩余时间仅自然变化。旧参与不可半途换解释；服务分成不是企业工资。新身体证明必须与来源、前态、时间和服务事件一致；不能让遗漏证明回退到旧预付效果。当前仅开放实验，未接入canonical/分区。


### 服务经营与真实雇佣

`resident-service-employment-v1`仅显式开放实验启用，要求实际服务时间、企业劳动且无已筹资旧服务。enterprise拥有独立服务账户授权、预付/成本/收入/退款台账；services拥有具名双方参与和交付，world将两者与个人工资原子组合。经营收入不属于老板私人现金，预付不是费用，退款不是利润。提供者本人接受精确授权版本；在岗等待与有效服务分别计薪，等待不产生患者效果或服务费。身体只结算一次，税/欠薪复用earnedCompensation，离开和解雇保留债权。自动破产清理不得跳过未结服务托管及欠薪。工资详情限本人/真实经营权限，经营读取不授予患者身体数据；ledger明确挑选可见字段，不能透传嵌套身体证明。服务自动收据使用世界事件序号形成有界领域ID，并用实际区间时间校验。公开服务分成不等于私营工资；公共工资、共同企业治理、完整清算与canonical/分区继续另行实现。


### 公共劳动开发边界

公共劳动归society，初始公共岗位不是企业别名，也不是居民已成立的公共机构。首版明确国库全额保护承诺资金、实际工时产生工资/税、未赚部分退款，不允许无国库铸币或接受后任意打折。economy的cumulativeUnitAllocation复用于企业工资、课程投入及公共劳动，society新增对economy的单向依赖仅引入纯整数分配算法，保护分段守恒而不复制公式。真实公共服务/产品仍须自己的来源收据；初始工时不能凭职称生成药效或产物。具体实施与未完范围见SOCIETY_PUBLIC_LABOR_V1.md。


### 企业经营控制与资本权益

`enterprise.control`复用authority纯原语，持有当前个人/集体经营控制及双边交接；新增enterprise→authority单向依赖。历史owner/股份、实际员工、既有服务/生产授权、已赚债权和资产不因交接改变。精确集体决定由开放应用事务验证并与领域效果一次消费，不能把执行者伪装成老板。进入新控制模式后，旧创立人/雇员身份不再自动授予公司资金操作权限；本人出勤/退出/工资保持独立。新清算把资产按真实权益分配，不能给管理员；旧事件不重新解释。实现路线与未完成范围见`specs/SOCIETY_ENTERPRISE_CONTROL_V1.md`。

### 企业原子经营交接

`resident-program-actions-v3`显式扩展enterprise控制语法，v2既有协议仍按v2执行。`ProgramActionsUpgraded`只作v2→v3升级，不改已签程序、授权次数或资产；旧manifest不改写。worker逐步校验enterprise域事件只改变精确管理control，禁止夹带现金/股权/劳动事件。出让者、接收者各自授权，真实执行者保留在独立receipt；失败不消费mandate、不提交临时offer。管理价款不等于股权转让，继任与全部清算仍须独立契约。

### 公共就业制度边界

`governance`只验证显式公共辖域、冻结程序与逐人表决；`society/publicEmployment`拥有现有初始公共职业的版本化申请门槛、配额、排序和容量。`world`原子消费批准决定并记录下一招聘周期生效的完整规则事实，申请/录取使用所属周期的版本；不得用最新政策重算旧周期。启用本身继承原规则，不是居民改革；普通文件/学历声明不能改变准入、工资或私营雇佣。查询和实际申请用同一状态，默认预览仅提供按需CLI入口。开放实验显式启用；不得把该能力等同于全部公共制度或canonical/分区完成。

### 居民共同资本领域

enterprise拥有显式启用的资本权利、冻结融资协议、独立同意与真实资金流事实；控制权、资本权利和员工本人权限分离。world原子编排个人/共同账户与`public-service:resident-capital`托管，流通对账含托管。旧fund不自动生成股权或贷款。新分红/现金清算用真实当前权利账户，旧老板/旧dividend/旧关闭不得绕过；库存与工资/服务义务未处置不可关闭。共同账户不能在仍持有有效资本或退款权时消失。仅开放实验显式启用，尚未支持完整实物清算、长期债务/继任、canonical或分区；不能把此阶段当作全社会完成。

### 居民住房选择边界

society/housingChoice管理显式启用的本人服务等级选择与版本；个人历史tier不是premises建筑质量、产权或实际住所。只能选择已登记较低标准，保留原欠费、库存、身体、租约与工作事实；升级继续沿真实已登记投入。world检查本人活动预留，已冻结的劳动/恢复输入不得被中途改写。旧升级/强制降级事件保留语义，仅在新模式增加选择版本失效。住房收费制度修改、真实空间服务接入、公共产权/建设与长期救济仍按`specs/SOCIETY_HOUSING_BOUNDARIES_V1.md`继续，不能以选择按钮代替全目标。

### 住房制度边界

显式 `resident-public-housing-v1` 将初始住房服务收费与升级准入归于 society.publicHousing，治理包只验证独立提案/表决/执行，world 原子记录制度变更。私人租约、建筑容量/产权、身体、工作、历史欠费不在该公共授权范围内。启用保留价格与准入来源、全部旧债与个人等级；新模式未来欠费只累计，不沿用旧自动降级并清债。旧manifest/事件保留旧语义。本人 `housing.standard/lower` 与公共 `governance.housing` 分开；常态仅给查询指针，完整规则按需分页。当前仅精确时间结算的开放实验；分桶历史结算、canonical、分区和长期债务救济仍在完整目标内。

显式 `resident-housing-occupancy-v1` 的登记住所与实际位置、当前使用许可、产权分开。本人精确版本退住只将登记住所设为null并释放登记容量；不移动身体、不删除租约、押金、欠款或物品。原换房/租约入住统一推进个人居住版本。许可到期保留既有居住事实，但不能从该事实推导新的无限期许可；查询需分别报告物理可用性和当前授权。


### 资源承担主体v2

- authority的resource-principals-v2区分resident/collective/enterprise/public与认证执行人；当前显式开放实验接通material stock。旧v1 Controller协议继续只认原主体，旧交接不能被改写成v2同意。
- material stock仍为库存/控制唯一真相，企业/公共付款或创建者署名不能代替控制；经营权限、资本权益、原许可和本人劳动分别核验。企业持有未关闭主体库存时禁止旧现金式关闭/清算；完整债务/遗产处置尚待实现。
- collective真相不复制进world。组合journal校验当前章程、精确决定及同一事务消费，经PrincipalCollectivePort供world读取；applyWorldEventWithPrincipalAuthority是显式组合回放入口，普通world回放不得把decisionId字符串当作有效权源。
- 新模式已接通组织供料、独立工程接受、本人实际施工与建筑交接；全模式人口退出或分区authority仍未接通。路线与当前边界见specs/SOCIETY_RESOURCE_PRINCIPALS_V2.md，禁止将库存主体能力当作完整公产建设完成。

### 组织使用许可

premises的resident-premises-principal-permits-v2显式扩展唯一permits登记表，旧记录/签名/收费订单不重解释。新许可逐次绑定实际企业管理、集体精确决定或公共独立决议，world在原子事件中检查真实权源；接受不代替实名使用人的身体同意。已接受时段随建筑交接保留；旧合同主体仍保留责任，企业退出不得忽略许可。当前免费许可实现与收费交易版本分开，旧v1/v2交易不得读取新主体许可作为证明；真实组织收费继续依完整Spec实施。实验接通不等于canonical/分区完成。

### 组织许可客观收费

commerce 的可选 `resident-principal-evidence-trade-v3` 与旧订单共享唯一真实托管账户；principalOrders 不另建余额或许可。world 原子绑定父订单授权、付款、`PrincipalPremisesPermitTradeAccepted` 和实际 provision；不得伪造另一项免费许可投票，普通许可包禁止这种子事件。enterprise.tradeAccounting 记录预付预留、实际费用与收益，经理不是收款主体。建筑交接保留原付款/收益账户；新旧托管都参与共同账户接收容量和退出责任。当前为开放 journal 的客观可用时间收费，不把它冒充完整和解/长期责任或 canonical/分区交付。

### 车辆承担主体与具名驾驶

mobility的可选`resident-vehicle-principals-v2`与车辆物理事实分离；纯领域只单向依赖authority，不依赖world/apps。原`ownerId`是历史来源，首次真实v2控制事件把旧隐含自用保留为可撤销具名权限；此后所有驾驶/载货路径同源使用`authorizedDriver`，普通VehicleChanged不得改控制/驾驶权/物理初始容量。企业经理、集体成员、公用车执行者不隐含成为司机，接管不转移原车费收入。

world通过现有PrincipalControl信封与独立VehiclePrincipals信封验证当前权源；公共车辆授权可独立启用，不要求材料制度，也不扩大其他资源辖域。集体决定与实际事件同一journal原子消费。旅程/预订阻止控制或驾驶许可变化，实际货物保管阻止撤销承运权限；停放车辆交接保留原货物/费用责任。企业关闭必须盘点车辆。组织经营车费、司机薪酬、完整退出和canonical/分区仍按完整Spec继续。

### 组织直接服务登记与重新供给

services的可选`resident-service-supply-v3`使用同一ServicesState内真实正整数目录登记版本。个人兼容发布也推进已启用版本；企业/集体/公共创建必须实际主体精确授权并与决定消费原子提交。controller与enterpriseId供给关联分开，企业可显式绑定自己但不能填另一企业；初始具名提供者为空，不制造身体、设施、工资或收入。重开只恢复原目录并核查当前真实容量/使用权，不重开旧时段或抹义务。普通servicesEvents不能冒充v2/v3权源事件，world必需实际目录端口。新provenance.serviceRegistration不能覆盖既有serviceSupply。多方关联同意、组织收入/工资、长期退出及canonical/分区继续按完整25项Spec交付。

### 服务关联企业独立同意

services可选`resident-service-affiliation-v4`拥有独立正整数授权登记，精确绑定现有目录的当前control请求、期限、实际企业批准来源。批准不推进目录版本，offer与后续accept分别按真实版本批准；当前目录主体仍独立行动。world在批准时核验企业/集体权源并原子消费决定，后来控制只读取该真实未撤回/未过期/未用记录，同意使用与控制原子提交，不能再次消费旧表决或伪造批准者执行。企业已作出的同意可跨管理人更替保留，现任程序可精确撤回；企业须仍实际可经营。旧v2事件/双方当前权源路径不改解释。私人预约/身体/工资不随控制批准开放；普通servicesEvents不能冒充v4事件，缺实际目录端口拒绝。

### 当前供给关系与历史来源

services可选`resident-service-supply-relations-v5`保留enterpriseId原发布来源，以版本化supplyRelation维护当前关系和目录主动邀请/企业独立接受。currentServiceEnterprise是供给、关联同意、CLI权限、企业清算盘点的同一端口；旧记录默认原来源，新显式null结束未来供给。目录/企业任一真实方可终止，但未结预约/队列/本人出勤不得抹去。其他企业不得单方邀请自己占别人目录。旧合同、工资和收退款不随关系结束变化。新的控制信封独立v5，不能回退旧v2/v4事件绕过待处理邀请；旧历史解释保留。企业退出后历史来源不再锁他人目录。普通服务查询不能泄漏supplyRelation授权正文，私人预约仍独立。全模式与完整长期责任继续交付。

### 实际住房休息效果

society的resident-physical-housing-rest-v1拥有显式恢复模型；premises提供真实住宅结构和已结算磨损事实，world按本人实际位置/实际睡眠区间记来源证据。许可到期或行政关闭不抹掉实体屋顶；旧服务等级上限、合同和欠费不改。启用需elapsed-rest/premises/occupancy且无活跃睡眠；裸world推进不可跨未结算磨损边界。开放worker使用原有工程边界分段，canonical/分区仍按R01待验收。


### 有偿资源控制与公共资产购买

commerce的resident-resource-sales-v1拥有即期固定报价、独立接受/撤回/拒绝和真实财务回执，当前首先接通真实已建建筑。premises拥有本体/交接，authority的boundPrincipalControlEffect只证明父操作明确绑定的accept/cancel范围，不提供独立权源。world校验父操作当前来源、原资源、余额和既有义务，在单一包内提交两笔平衡清算与原交接效果。清算账户提交前后为零；普通免费接受不能绕过任何同控制版本付费绑定，买方拒价不自动变赠与，卖方撤回原子取消相应交接。

公共购买资产需要显式public-paid-resource-control-v1财政接管扩展，普通管理或许可费用授权不足。企业现金收付由enterprise-resource-sales-cash-accounting-v1记账，不改经理钱包；这不是固定资产资本化/折旧账簿。报价查询按需授权、只引原义务版本、不广播私人合同，不展开后继控制者私人提议。当前仍是开放journal接入；固定资产会计/清算、其他实物销售、公共在建项目和canonical/分区仍按完整Spec交付。


### 库存与车辆有偿控制扩展

遵循`specs/SOCIETY_PAID_MATERIAL_VEHICLE_V2.md`。commerce通过显式resident-resource-sales-v2扩展原报价聚合，旧v1来源/条款/事件保留。materials和mobility分别提供真实stockTransferFacts/vehicleTransferFacts，world补当前外部保管/货运引用，并通过所属领域控制端口原子交割、平衡清算。库存不搬家、不造地/仓库；车辆不瞬移、不造司机同意、不把受托货物或原运费给买方，驾驶/预约/保管约束保留。

public-paid-resource-control-v2扩大财政资产类别，但PublicProposal的可选resourceSalesScopeVersion由领域决策捕获；旧v1/缺字段提案不能继承库存/车辆采购权限。扩展不改旧提案，不抹旧公共许可或角色。enterprise-resource-sales-cash-accounting-v2仅扩展真实现金来源类别，保留旧回执、拒绝降级，不是固定资产资本化。共同清算使用封闭resource-sales-v2来源；正文仅交易当前主体按需查询。固定资产会计、长期义务、公共在建项目、整体清算和canonical/分区仍按全部Spec继续。

### 有限周期付款责任

commerce 的 `resident-periodic-obligations-v1` 拥有双方冻结原文/真实账户/有限总额和周期、独立接受、逐期支付/欠付与放弃。标题不能制造租约、会籍、教学、服务、本金、利息或抵押，既有债务不得在这里复制。world 从所属领域读取实际账户事实，按到期边界/合同ID/期号顺序原子支付；不足只记一次欠付，不自动重试、借款或补钱。`public-service:resident-periodic-obligations` 为同一提交中清零的流通结算账户，两条腿均平衡。

enterprise 拥有独立版本的现金收付与原承诺位置，欠付保护分红、未来责任及欠付阻挡关闭；快照不能删除企业承担的金融位置或承诺中的企业。共同账户清结可付已有债务、不能发新承诺；公共须独立显式有限财政范围、冻结批准范围并保护实际准备金。当前管理/集体程序/公共程序按整份精确请求独立授权，真实执行者与历史权源分开；程序白名单不允许凭一次代理额度创建周期责任。

默认上下文仅增加 `town obligations list` 指针，原文与各期回执当前主体授权、分页按需查询；历史作者不获得永久私人入口。显式开启不改旧manifest、不补造原文同意或种子现金。自然人遗产、困境企业的专门处置权限、整体实物清算与canonical/分区协调器仍在完整目标内，不能将金融切片当作这些能力的完成。


### 开放社会日志恢复

`openSociety/journal`保存完整组合效果，而非只有WorldEvent。运行者`recover-journal`仅在独占写锁下验证完整前缀后处理末尾，先持久保存原始字节/摘要与prepared意图，再原子替换；正常启动不自动修复。完整记录损坏、hash/序号/重复请求错误不得靠截断绕过；完整末记录仅缺换行时验证后保留。恢复不重跑决策或队列、不改manifest、不授予居民管理能力。当前是单机PID锁与本地原子文件恢复，不代表跨主机/分区接入；路线见`specs/SOCIETY_RUNTIME_RECOVERY_V1.md`。


### 完整社会常驻入口

server的显式resident-society子命令复用residents daemon与OpenSocietyRuntime的完整单写入journal、认证CLI和受限OpenCode。仅打开已初始化目录，不隐式迁移canonical或启用策略。daemon掌管调度时管理员HTTP不可并发start/finish/advance；供应商失败停止，先abort并等待退出再释放writer。居民等待/原交接和requestId去重保持原语义，不注入组织任务。server→residents是外层adapter复用，不得形成反向依赖；跨主机分区和旧界面迁移仍按R01继续。

### 显式社会组合运行配置

`worker/openSociety/runProfile`拥有`society-integrated-v1`固定发布清单，仅由运行者在新目录初始化时显式选择。它复用各领域版本化启用端口和场景来源，不生成居民同意/制度；旧默认与旧manifest不自动升级。profile来源通过既有规则查询按需读取，不新增居民命令或强制社会目标。此配置与正式单机daemon的成功不等于全部25项或分区authority交付，见`specs/SOCIETY_INTEGRATED_PROFILE_V1.md`。


### 完整社会事实投递

`openSociety/commitDelivery`按manifest摘要与连续hash投递完整提交；副本只调用同一reducer，不重跑程序或公共结算。journal持久replica角色阻止误启动Runtime，确认来自fsync后的日志游标，重投不得重复写入。全量原文仅限受信管理HTTP/运行者CLI，不进入居民上下文；hash不是签名，管理token不可给居民。当前管理端读取不是分区专用最小权限，归属/调度/独立凭据与canonical迁移仍未完成，见`specs/SOCIETY_COMMIT_DELIVERY_V1.md`。


### 分区计算授权边界

residents的`partitionExecution`是计算入口与调度编排，不产生居民社会授权。静态归属持久化且不可静默更换，分区长期token只领取本区轮次，模型只持有短期本人token；重启/过期/交接后旧token不能写入，异步请求body后须再次复核。未结束轮次或当前待醒居民阻止模拟时钟推进；共用residentWake读取真实唤醒/活动边界，不复制领域公式。原turn/request去重和wait交接保留，副本不执行决策。现有单机会本机分区入口不代表跨主机部署、永久调度器或canonical迁移完成，见`specs/SOCIETY_PARTITION_EXECUTION_V1.md`。


### 持续分区与供应商交接

`partitionWorker`只轮询授权机会，不自行推进时间或自动重试失败模型。计算目录在claim前绑定持久权威身份与分区，authorityId再次随claim核对；scope/actor/turn匹配的实际session观察和精确完成结果才能用于恢复，先持久回执再finish。记录不能造领域事实，副本仍不执行决策。OpenCode会话观察须在退出前落盘；I/O失败不能当作非JSON诊断吞掉；同turn旧证据不可覆盖。当前有序中断与丢失交接恢复不等于SIGKILL孤儿接管、多主机或canonical迁移完成，见`specs/SOCIETY_PARTITION_CONTINUITY_V1.md`。

### 远端权威传输

residents的authorityEndpoint统一校验凭据承载origin；非回环必须HTTPS，不允许redirect、userinfo或业务base path。监听非回环需显式TLS，通配监听须有advertise-host；Node原生证书与主机名校验不得关闭。受限shell仅新增NODE_EXTRA_CA_CERTS信任文件透传，不继承NODE_OPTIONS或provider凭据。TLS不替代分区/本人/管理授权，不生成新社会能力或上下文；同机隔离容器网络验收不能冒充物理多机生产部署，见`specs/SOCIETY_REMOTE_TRANSPORT_V1.md`。

### 服务协议显式过渡

services的`resident-service-policy-transition-v1`在旧v1/v2服务供给关闭、预约/队列/提供者时间全部处理完后，通过`ServicePolicyUpgraded`切换未来服务到v3。原记录不重算，退役旧服务不能通过普通或主体reopen复活，需新声明；无自动教师、医护、参加或满意度。worker服务阶段只编排现有端口，公共授权前置单独显式处理。当前私人多主体服务登记对公共注册的依赖仍是待审视边界，不能静默绕过旧事件校验。

### 服务主体权限独立

services 的 `resident-service-principals-v3` 与显式 `ServicePrincipalAuthoritySeparated` 分离服务能力和公共授权；v2 旧事件保留原校验。world 按当前持久目录策略检查集成事件，个人/企业/集体服务不以公共 grant 为前提，公共主体仍使用真实提案证明。启用不创建或扩展公共 grant；已有义务、提供者同意与场地权限不变。`enable-independent-society-services` 为独立开放 Runtime 的 v2 阶段入口，非全模式接入完成证明。

### 迁移原料来源声明

materials 的可选 `declared-material-endowment-v1` origin记录明确新增供给，不冒充原世界历史资产；canonical迁移世界首次enable-physical-production必须提交显式声明，不能走默认场景播种。同声明重试不得补满已经采走的数量，异声明拒绝；world仍验证有限来源与旧再生池互斥、地点及实际劳动。来源仅主动sources查询可见。身体/学习阶段不推断旧wageCalculator的真实时薪，工资迁移仍需独立明确条款。

### 明确劳动计价条款

enterprise的可选laborTerms由显式EnterpriseLaborTermsEnabled启用，金额微单位复用earnedPayroll，计价周期由企业提出、员工独立接受。成员关系代次只在启用后维护，旧快照不补造同意；离职再加入不能复活旧接受，管理交接不能补签原管理版本的提议。新条款只选择未来工作来源，不修改旧会话或已欠工资。开放居民world/CLI已接入显式accepted-enterprise-labor-terms-v1，普通工作、实际生产及服务工资共用冻结报价端口；集体企业操作必须精确批准并原子消费，不能代员工接受。生产/服务授权绑定报价版本，后续换约不重定价已开工会话。仅未启用旧实际劳动模式可用enable-agreed-labor，原manifest不改；非企业初始岗位、既有旧模式过渡及全部canonical/分区整合仍未完成。


### 明确新增的服务设施

`declared-service-facilities-v1`通过运行者register-service-facilities在已启用服务的世界登记明确新增护理/教学位。premises拥有唯一设施及来源，world核验实际地点人数容量和整批原子事件，worker负责幂等与未结束轮次拒绝。不得从旧地点名称/用途推断设施，也不补造原建筑/产权、提供者、协议或同意。居民仍走实际建设/服务端口，来源仅随engagements.facilities主动查询；全原运行模式与历史场所实体化仍未完成。

### 独立资源适配策略

world 的 `independent-resource-adapters-v1` 只分离资源域接入与公共授权，不复制资源真相。运行者显式选择已有stock/premises/vehicle，原子记录 `ResidentResourceAdaptersEnabled`，调用原领域applier；保留既有适配种类、报价、义务和公共grant。无公共授权不能代表公共主体或扣国库；私人交易不要求无关车辆/建筑。旧事件和manifest不隐式升级，canonical组合要求策略来源一致。独立启用后的新增公共范围入口与完整分区写入仍待验收。


### 原租约退出结算

原ResidentLeaseChanged可选resident-lease-continuity-v1绑定原合同修订、实际结算边界/活居民操作、commerce押金与平衡账、estate现金来源回执。society验证不可变条款与记录效果，world原子结算；租金经原commerce托管净额为零，押金只退原租客实际账户。普通commerce不得冒充死者；死亡不自动免租、驱逐、转产权或授权继任人。缺失/伪造证明拒绝，旧活居民事件不重解释；自然人口和整体继任CLI仍待完整消费者及容量验收。


### 私人服务关闭依赖

world.serviceClosurePolicy由ResidentServiceClosureEnabled显式记录，表示企业/资本关闭须读取services权威目录，不是公共grant。新私人服务启用原子附带该记录；旧v3通过enable-service-closure迁移，不重解释旧journal。新模式缺目录拒绝，孤儿责任阻止迁移，不能把UNKNOWN当已清；canonical组合把marker作为agreement，服务状态仍在所属聚合。


### 原服务保管收入

ResidentServiceEngagementsCommitted可选estateCashBatch按resident-estate-gross-settlement-v1保留原逐笔账与来源回执；只能用于已funded合同的原保管收款，不能从死者发起新扣款。服务拥有域先核验原约定和真实效果，world原子提交托管/实际账户/材料/身体。批次不得净额化透支、漏行、乱序或重复；普通financialAccount和本人参与校验不放宽。此切片不代表服务参与者死亡中断或自然人口/整体继任已接通。


### 退出后的已赚工资

定时企业劳动的可选 `ResidentLaborCommitted.estatePayment` 使用 `resident-earned-wage-estate-v1`：system 仅能冻结已保全退出者原已结算劳动，或支付原已结束工资债权。enterprise/原earnedCompensation证明继续拥有债权、付款和累计税；world earnedWageEstate只把已证明账务拆成净额为零的clearing毛额腿并应用原estate现金回执。支付时间与劳动赚取时间分开，不重建身体/预留、不制造未来工资；普通居民命令仍要求本人。生产/服务工资、自然人口顺序与自动追偿调度仍需分别接通，不把定时工资切片等同整体人口交付。


生产/服务原工资的 world 内部 `settleDepartedProductiveWageEvent` / `settleDepartedServiceWageEvent` 只支付各来源已有的已结束债权，执行者明确system，原赚取截止不晚于真实退出。optional estatePayment 复用 earnedWageEstate，不改旧事件，也不重新执行生产/服务或自动停止活跃身体。普通本人领取仍要求身体存在。活跃工作的退出边界、自然人口和自动后续偿付需独立编排验收，不能用现金adapter替代。


### 明确系统生产中断

materials 的内部 interruptMaterialProduction 在精确已结算边界记录 production-interrupted-v1/system 与 worker-unavailable；只能停止未来参与，不能增加工时、消耗或产出，原held材料不归还也不销毁。applyMaterialCommit验证精确事件及原状态。world的可选resident-material-employment-interruption-v1证明核验真实生产/雇主/工人、当前雇佣失效或身体不可用；普通CLI无此操作。雇佣生命周期使用该端口，不再冒充本人leave。必须在删除身体前编排；完整人口/其他活动终止和资产责任捕获仍需整合。


### 雇佣退出候选编排

world.prepareResidentEmploymentDeparture接受当前边界真实人口来源，先释放目标成员、按原领域停止已结算劳动，再用最终余额生成capture和人口事件；只返回完整候选批次，调用者必须单次journal事务提交，不能分条发布。stopUnavailable*的onlyActorId不改变旧无过滤调用语义。未结算睡眠/学习/劳动/建设与残留移动/其他在场拒绝，不静默抹去；已结算睡眠和学习按活动来源端口终止。尚未接入worker自然人口和完整责任域，不是全部活动退出或canonical人口启用的证明。


### 退出时睡眠与学习

world residentDepartureActivity把实际人口来源以resident-departure-activity-v1记录为system动作，必须与最终人口事实同批提交。society睡眠只在已结算边界中断；学习新增population-departure原因，必须system且world来源核验通过。恢复/知识/原累计收费不增加，未用学费按原本人或国库退还，然后捕获最终个人资金。旧事件无来源字段继续原解释；此端口不判断死亡/迁出，也不开放新居民命令。自然人口/完整journal接入、建设/移动/在途保管等仍未整体交付。


### 退出时施工终止

premises.interruptConstruction只在已结算边界停止真实会话，保留open工程/计划/进度/控制/土地及材料义务；不取消、退料或制造建筑。world用residentDepartureActivitySource人口来源校验，ResidentPremisesCommitted可选departure约束单一工程、零努力/材料流和精确释放。来源契约独立于活动编排，具体适配器不得反向引用编排器。建设候选已接入，移动/货物/其他活动及完整人口journal仍须继续验收。

### 货运原托管退款接续

ResidentLogisticsCommitted可选estateCashBatch复用resident-estate-gross-settlement-v1，world物流来源端口仅接受原已出资合同的正向收入，不放宽普通actor/付款授权。logistics先验证原交易/修订，materials验证实际保管/退回，world同事件映射到原主体保管账户；装载后取消仍留实物和托管直到真实退回。不得因付款人退出瞬移货物、冒充本人cancel或赋予他人承运权限；承运人退出、在途终止与自然人口仍需独立接入。


### 行程中断事实

mobility的VehicleJourneyInterrupted使用vehicle-journey-interruption-v1，保存原旅程上的停止时间与实际elapsed，保持车辆/订单/原参与者和权限；不制造到达、坐标或运费。普通VehicleChanged不能改写中断，自动推进不得把中断接客视为超时退款。world拒绝缺少完整transportInterruption的单独提交；当前车辆候选通过同包来源/transit/真实时间核验停止同行身体，位置依据归interruptedTravelByAgent并在退出后保留。普通移动不能利用null位置绕过接续；原货物/运费不变。保管接续、步行和真实runtime人口事务仍待验收，不允许CLI直接调用领域事件。


### 货运当前保管人与原合同

logistics.custodyHandoff独立持有版本化交接许可和当前holder引用，不修改FreightTerms或原费用受益人，不复制库存。源/收/付权限分别经authority端口，本人在世的前保管人和实际接手者须独立同意；前人退出来源由world核验，不能借缺人自动指定继任。执行前重核当前许可，未执行提议可撤回，物理接手必须本人并经真实位置/载荷/载具端口。个人/集体停放货物的world adapter和显式journal/CLI已接通；普通原文提议不能直接变为资源授权，不能以内部测试代替实际居民接续验收。

货运保管接续的world个人端口已接通：ResidentLogisticsCommitted.custody显式启用/独立事件，校验实际材料、停放位置、本人/退出来源和载荷。所有物理操作者读取freightCustodian，原合同carrierId继续拥有原费用；不得用原字段绕过新holder或把钱改付接手人。交接包禁止夹带账务/材料效果。在途/中断不按原节点交接，个人接续通过显式enable-freight-custody journal事件启用，历史manifest不改；自然人口runtime与全模式仍待完成，旧世界不隐式启用。

货运集体许可由可选freight-custody-collective-grants-v1显式启用：source/recipient/payer的propose/consent/withdraw使用现有collective精确resource决定，worker把物流事实与唯一决定消费原子提交。world经FreightCustodyCollectivePort读取所属collective事实，缺外部授权端口拒绝。已执行同意是原提议的持久许可，accept核验原角色/决定/当前章程版本而不重复消费；不依赖历史代表继续存活。集体作者/旧签署者没有永久个人撤回权，撤回用当前精确集体权限；本人accept仍不可代理。普通world/canonical/分区不得用事件中自报decisionId替代真实端口。

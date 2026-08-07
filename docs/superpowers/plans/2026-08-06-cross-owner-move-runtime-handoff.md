# Cross-Owner Move Runtime Handoff 实施计划

> 对齐 HANDOFF「建议的后续接手顺序」第 4 步与 `docs/PAPER_ALIGNMENT_MATRIX.md`
> §3 spatial/social 行的剩余 gate。本计划是机制实现,不是论文实证。

## 目标与定位

让 `AgentMoveTo` 成为 **simulation-wide authority 结算的全局空间命令**,并在
目的 location 归属另一 partition 时完成 **owner-transfer runtime handoff**
(Agent durable 认知状态迁移 + 双区 replay materialization),使矩阵 §3
spatial/social 行从 "In migration" 升级为 "Mechanism verified (default path)"。

**论文对齐点**:论文 §3 的空间系统是全 simulation 单一权威——容量、共处、
路线都必须对同一份空间状态校验。当前 partition 直写 move 只对本地投影做
容量/路线校验,跨 partition 语义不成立;这正是本计划修复的机制缺口。

**claim 边界**:partition 与 owner 归属是本仓库的扩展伸缩机制,论文没有
partition 概念。location 归属规则是仓库设计决策,必须在 manifest 显式声明,
不得隐式推断。

## 不变量(违反即回归)

1. authority 未启用时行为逐字不变(现有 1231 测试零回归)。
2. 权威市场仍是只读覆盖;checkpoint==replay 不变量保持:authority 结算产生
   的事件只经 inbox→materializer 落回 partition stream,绝不直写。
3. move 路由后,同一 move 命令不得既走 partition 直写又走 authority
   (单一派发点,沿用 trade/conversation 的 router 模式)。
4. owner 只在 authority 判定 arrival committed 后翻转(in-transit 期间 owner
   不变,源区继续执行该 Agent)。
5. 认知快照只包含该 Agent 的 durable 认知状态(STM/LTM/intention/plan/
   progress),绝不携带其他 Agent 数据;快照进入 authority operation 记录,
   受同一账本审计。

## 改动分层

### 第 1 层:全局空间结算(同 owner move 经 authority)

**1a. router 增加 AgentMoveTo 路由**
- 文件:`apps/worker/src/simulationCommandRouter.ts`
- `GLOBAL_COMMAND_TYPES` 增加 `'AgentMoveTo'`;`settleGlobalDraft` 增加
  move 分支 → `authority.settleMove({ operationId, agentId, targetLocationId,
  reason, destinationPartitionKey, lease... })`。
- destinationPartitionKey 由 host 注入的 **location affinity 解析器**给出
  (见 1c);解析不出归属时 = 当前 owner(纯位置变更,不换 owner)。

**1b. authority.settleMove**
- 文件:`apps/worker/src/simulationWideAuthority.ts`
- 对全局投影派发 `AgentMoveTo`(容量/路线校验因此是全局语义);
  `AgentLocationChanged` 立即出现 → arrived,否则进 `pendingMoves`
  (与 `pendingTransfers` 同构,travel 由 `advanceTime` 完成)。
- 新增 operation kind `'move'`;destination == 当前 owner 时 inbox delivery
  只发 owner 分区;跨 owner 时按第 2 层语义发双区。
- `advanceTime` 的 delivery 扩展:`time-advanced` 除 completedTransfers 外,
  把 completedMoves(同 owner travel 到达)的到达事件投递给 owner 分区
  ——修复当前同 owner travel 到达事件丢失的隐患。

**1c. location affinity(manifest 显式声明)**
- 文件:`apps/worker/src/localSimulationRuntimeHost.ts`、manifest 类型
- partition manifest 增加可选 `ownedLocationIds?: readonly string[]`;
  host 构造 `resolveLocationOwner(locationId): PartitionKey | undefined`
  (恰被一个 partition 声明 → 该 partition;0 个或多个 → undefined,不换 owner)。
- affinity 传入 router;冲突声明(同一 location 被多区声明)在 bootstrap
  fail closed。

**验收**:单测覆盖——move 经 authority 结算后事件经 inbox 落回 owner 流;
容量校验用全局占用数;travel 到达经 advanceTime 投递;affinity 未声明时
owner 不变且行为与第 2 层前一致。

### 第 2 层:owner 翻转与认知快照

**2a. 认知快照捕获**
- 文件:`apps/worker/src/simulationCommandRouter.ts`(+ 新文件
  `agentCognitiveSnapshot.ts`)
- router 在 settleMove 前从源 partition storage 读该 Agent 的:
  STM records、LTM profile、intention(含 activeObjective)、branch plan、
  plan progress。序列化为 `agent-cognitive-snapshot-v1`,随请求交给 authority。
- 快照只在该 move 会跨 owner 时捕获(destinationPartition ≠ 当前 owner)。

**2b. authority 快照保管与投递**
- `move` operation 携带可选 `cognitiveSnapshot`;跨 owner 完成时:
  source 分区 inbox 收到 departure 事件;destination 分区 inbox 收到
  arrival 事件 + 快照引用。快照持久在 operation 记录中(体积控制留待
  journal compaction,已知 TODO)。

**2c. world 事件:`AgentOwnershipTransferred`**
- 文件:`packages/world/src/events.ts`、`projection.ts`
- payload:`{ agentId, fromPartitionKey, toPartitionKey, transferredAt }`。
- `applyWorldEvent`:本事件出现在某 partition 流中时,语义由 materializer
  解释(源区:从投影移除该 Agent;目标区:以快照 hydrate 后加入投影)——
  投影层的 apply 保持中性(记录事件),归属语义在 materializer 执行,
  避免 world 包依赖 partition 概念。

**2d. materializer 双向处理**
- 文件:`apps/worker/src/simulationWideAuthorityMaterializer.ts`
- 源区:应用 departure 事件后,从投影移除 Agent;该 Agent 的 durable
  认知数据保留在源区(审计/回放),tick 自然不再调度它。
- 目标区:先用快照 hydrate 本区 repositories(幂等:已存在则校验一致),
  再应用 arrival 事件,Agent 进入本区投影,下一 tick 起由本区执行。
- 崩溃恢复:hydrate 与应用都幂等;recover() 重放不产生重复 Agent。

**验收**:多 partition 集成测试——Agent 从 world-main move 到 world-east
声明归属的 location → travel 完成 → owner 翻转 → 东区 tick 用迁移后的
objective/memory 继续规划,西区不再调度;重启后状态一致。

### 第 3 层:planner 衔接与文档

- planner 已有「向目标 location 移动」分支(configured target);directory
  候选若不在本 location,允许产出 move-to-remote-location 意图(可选增强,
  默认不做,保持共处候选的最小语义)。
- 更新 `docs/PAPER_ALIGNMENT_MATRIX.md` §3 spatial/social 行证据与
  promotion 说明;SCIENTIFIC_LIMITATIONS 不受影响。

## 风险与取舍

- **快照体积**:大记忆 Agent 的快照会放大 authority state.json;机制阶段
  接受,compaction 列入 journal 强化项(清单⑦)。
- **旅行中的双区竞态**:in-transit 期间源区仍执行 Agent,到达才翻转——
  与 authority 现有 transfer 状态机一致,不引入新竞态。
- **affinity 未声明的部署**:move 全部保持同 owner,行为等同第 1 层前,
  零破坏。

## 实施顺序

1. 第 1 层(1a→1b→1c),每步 `pnpm check`。✅ 已完成(提交 7681393;1c 并入第 2 层)
2. 第 2 层(2a→2c→2b→2d),集成测试收尾。✅ 已完成:world 事件
   AgentOwnershipDeparted/Arrived、agentCognitiveSnapshot 模块、settleMove 跨
   owner 语义、router affinity+快照捕获、materializer 到达水合、host 时钟同步
   与 affinity 冲突 fail-closed;214 test files / 1242 tests 通过
3. 第 3 层文档。✅ 矩阵已更新

补充实现说明(原计划之外的必要决策):
- **authority 时钟同步**:canonical 运行时原先从不调用 authority.advanceTime,
  现由 host 的 preTickMaterialize 在每分区 tick 前把 authority 时钟推进到分区
  时钟(operationId 按目标时刻派生,锁步分区二次调用为幂等 no-op),否则旅行
  到达永远无法完成。
- **到达投递过滤**:time-advanced 对 completedMoves 只投递该 move 的
  departure/arrival 事件,绝不投递全量推进事件——避免 owner 分区二次推进时钟
  (transfer 旧语义保持不变)。

不 commit 策略沿用主线:完成后按层拆分提交。

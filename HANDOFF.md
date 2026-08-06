# AIvilization Town Handoff

更新时间：2026-07-27
代码基线（HEAD）：`8908fe1e304e99128dd1735bebf9e90124118466`
当前分支：`feat/architecture-skeleton`

## 当前结论

仓库已经把"一个统一小镇、一个市场"从"可注入但默认关闭"推进为**默认运行路径**：
simulation-wide authority 现在默认启用，多 partition 的 AMM 池子合并为一个全局池，
canonical tick 的 trade/conversation 经 authority 结算并由幂等 materializer 落回 partition，
agent 规划与市场价格指数都读权威全局价格，society projection 报告 `unified-authority` 市场。

但这仍属**机制验证**，不是论文实证复现。统一社会的**自主闭环**尚未合上：canonical planner
还不能自主选择目录里的远端、共处 Agent；cross-owner move 的 runtime handoff 未实现。§4/§5 需要
的真实成熟长跑、稳定市场区块、消融矩阵都还没有产生。

## 已经完成（本轮两步，均已验证）

### Step 1 — authority 接入 canonical tick + 幂等 partition materializer

- `simulation-wide-authority-v1`（file-backed、lease-fenced 全局账本）从"完整但孤立的模块"
  升级为"可在 host 内启用并端到端结算"。
- 新增 `simulationWideAuthorityMaterializer`：消费 partition 的 authority inbox → 幂等 append 到
  partition event stream → 写 owner STM → 推进 projection checkpoint → `acknowledgeInbox` 原子推进
  durable cursor；recover 对已消费 delivery 幂等 no-op。
- 新增 `simulationCommandRouter`：agent cycle 的 trade/conversation draft 路由到 authority 结算；
  produce/sleep/study/work 等 partition-local 命令仍走直写；authority 拒绝时复用 partition
  dispatcher 产出 `ActionRejected`，不中断 tick。move 暂不路由（等 owner-transfer handoff）。
- 单一派发点 + legacy 会话降级：authority 启用时 legacy 跨区会话事务 disabled，
  HTTP `/society/interactions` 返回 `409 social_interactions_managed_by_authority`。

主要文件：`apps/worker/src/simulationWideAuthorityMaterializer.ts`、`simulationCommandRouter.ts`、
`localSimulationRuntimeHost.ts`、`localRuntimeStep.ts`、`tickRunner.ts`、`agentCycleRunner.ts`、
`localSimulationBackendRegistry.ts`、`localSimulationSocialInteraction.ts`、`apps/api/src/httpApi.ts`、
`apps/server/src/localRuntimeTownCli.ts`。测试：`localSimulationRuntimeHostAuthority.test.ts`。

### Step 2 — 统一 AMM 合并 + authority 成为默认路径

- **池子合并**（`localSimulationRuntimeHost.ts:mergeSeedProjection`）：per-partition 池子按 commodity
  求和成一个全局 AMM（种子比例一致，求和保持初始现价、深度随人口放大），moneySupply 求和为全镇总额；
  commodity 集合分歧则 fail closed。
- **只读权威市场覆盖**：一个 market override 从 host → `preTickMaterialize` → step → tick →
  agent provider → `createWorldDecisionContextFromProjection` 贯穿，agent 的 spotPrices 与生产规则
  定价读权威全局价（每 tick 采样一次）。
- **价格指数覆盖**（`marketMetrics.ts`）：价格指数的**数值**从权威池派生，而
  `MarketPriceIndexRecorded` 事件仍 append/apply 到 partition stream —— 关键不变量：**权威市场是
  只读覆盖，绝不写入持久化的 partition projection/checkpoint**，保证 checkpoint@N == replay(1..N)。
- **society projection**：`describeMarket` 在 authority 启用时报告 `unified-authority`（一个全局池 +
  全镇总货币），关闭时仍报告 `consistent-replica` / `partitioned`（不伪造平均价）。
- **默认翻转**（`localRuntimeTownCli.ts`）：authority 现在**默认启用**
  （`parseBooleanFlagWithDefault(..., true)`）；显式 `--simulation-wide-authority off` /
  `AIVILIZATION_SIMULATION_WIDE_AUTHORITY=0` 回退 legacy 路径。`--help` 已更新。

主要文件：上列 host/step/tick/agentCycle/agentScheduling/canonicalAgentProvider、
`marketMetrics.ts`、`localSimulationSocietyProjection.ts`、`localRuntimeTownCli.ts`。
测试：`localSimulationRuntimeHostAuthority.test.ts`（+3）、`worldDecisionContext.test.ts`（+1）、
`marketMetrics.test.ts`（+1）、`localRuntimeTownCli.test.ts`（+1，默认 + 显式 opt-out）。

## 本轮验证（本会话实测，非转述）

```text
pnpm lint         通过
pnpm typecheck    13 包全部 Done
pnpm test         211 test files / 1200 tests passed
git diff --check  通过
```

覆盖要点：多 partition 池子合并为一个全局池且两区 agent 对同一池交易；agent 读权威现价而非
过期 partition 池；价格指数从权威池派生且 partition checkpoint 池不被污染；society projection
报告 `unified-authority`；CLI 默认启用与显式 opt-out；default-100（两 partition）daemon 集成测试在
authority 默认开的情况下通过。

注意：本轮**没有运行 `pnpm build`**；完整 lint/typecheck/test 属机制验证，不等同论文实证或规模验证。

## 尚未完成

### 统一社会自主闭环（下一步的主线）

- **canonical planner 仍只从本地 projection 选目标**。跨区 interaction/trade 现在只能由 service/HTTP
  显式触发，Agent 尚不能根据全局目录自主选择远端、共处 Agent（选到远端会落 `unknown target agent`）。
  需要给 agent-cycle dispatch 增加 simulation-level interaction/trade intent seam。
- **cross-owner move 的 runtime handoff 未实现**。authority 的 `transferAgent` 有 in-transit→completed
  状态机，但跨 owner 的 Agent storage 迁移 + replay materialization 没做；move draft 仍走 partition
  直写，未路由到 authority。这是 §3 spatial 行仍为 "In migration" 的原因。
- **多进程 worker 尚未通过部署级 coordinator discovery/health contract 使用 authority**；目前
  file-backed authority 在单进程 host 内提供共享存储语义与 fencing。
- authority projection 尚未作为部署级 UI/HTTP source（保留 owner partition 的 cognition detail）。

### 论文功能与经验复现（比写代码更大的一次实验投入）

- 真实外部 IdP、TLS 部署、MFA/撤销/恢复演练与真实参与者 cohort 尚未完成。
- §4 要求的成熟市场长跑数据、稳定窗口、40 万笔分析区块尚未形成；§4 分层/轨迹、§5 消融的分析
  管道都在，但只跑过合成/短数据，**不算复现**。
- §4/§5 的实证复现依赖一次**真实、声明模型/种子/重复次数/不确定度的成熟统一社会长跑**，且需在
  Step 3–5 的功能闭环合上之后再跑，否则跑出来的是"半统一"社会的数据。
- 论文宣称的万级/百万级规模与因果效应，本仓库从未建立；旧拓扑的 soak/资源证据不能冒充。

## 已知边界与风险

1. authority 启用时，trade/conversation draft 经 command router 单一路由到 authority 结算，legacy
   conversation transaction 同步 disabled，二者不能并发负责同一 interaction。move/time-advance/
   market-price-index 仍走 partition 直写，与 authority settle 在同一 tick 内通过 partition stream 的
   expectedVersion 串行，未跨进程。
2. **权威市场是只读覆盖**：agent 规划与价格指数读权威池，但绝不写入持久化 projection/checkpoint。
   这是因为 `TradeExecuted.poolAfter` 是绝对值且 inbox delivery 只到 owner partition，若把权威池写入
   partition snapshot 会破坏 checkpoint==replay 不变量。相关测试显式断言 partition 池不被覆盖污染。
3. 池子合并按 commodity 求和依赖"各 partition 种子池比例一致"这一 profile 事实；commodity 集合分歧
   会 fail closed。若未来出现异比例种子，需要重新审视合并语义（现价将不再由求和保持）。
4. tick 内市场覆盖每 tick 采样一次：同一 tick 内先行 agent 的交易不体现在后续 agent 的现价视图里，
   与 legacy 语义（本 tick 交易下一 tick 才 materialize）一致，暂可接受；逐 agent 实时采样是后续优化。
5. STM 恢复去重依赖 owner 最近记忆的稳定 record ID，成立于"单 host 崩溃后先恢复再 tick"的顺序；
   分布式场景需要真正的幂等 memory materializer/inbox。
6. authority operation journal 有 schema、fingerprint、fencing，但尚无 hash chain、compaction 或远程
   object-store backend。

## 建议的后续接手顺序

1.（已完成）authority 接入 tick + 幂等 materializer + command router。
2.（已完成）统一 AMM 池合并 + 只读权威市场覆盖（规划/价格指数/society projection）+ authority 默认启用。
3. **给 agent-cycle dispatch 增加 simulation-level interaction/trade intent seam**，让 canonical planner
   能选择目录中的远端、共处 Agent，而不是落入 `unknown target agent`。（纯代码、可测、无外部依赖，推荐下一步。）
4. 完成 owner-transfer runtime handoff（Agent storage 迁移 + replay conflict 处理），使 cross-owner move
   经 authority `transferAgent` 真正生效，并把 move 路由到 authority。
5. 将 authority projection 作为部署级 UI/HTTP source，保留 owner partition 的 cognition detail；多进程
   worker 通过部署级 coordinator 使用 authority。
6. 上述功能闭环完成后，再运行论文长跑、市场统计、分层、轨迹、消融、恢复演练与规模验证——这是一次需要
   先定模型与 compute 预算的实验投入，不是继续写机制代码。

## 工作区状态

- 本轮 Step 1/2 的改动**尚未 commit、未 stage、未 push**；请先 `git status --short` 核对当前工作树，
  不要把本 handoff 的历史条目数量当作当前工作树数量。
- 接手者不要用破坏性 reset 清理工作树；应先按模块审查并拆分提交。
- 本文件是一次性交接快照，不是动态任务追踪器。

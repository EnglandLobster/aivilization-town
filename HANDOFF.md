# AIvilization Town Handoff

更新时间：2026-07-23
代码基线：`f064590e80099d0dc9d5c0a8dc635002b6a26a71`
当前分支：`feat/architecture-skeleton`

## 当前结论

仓库已经具备较完整的单 partition AI 社会运行机制，但还不能宣称已经复现论文中的
“一个统一小镇”。当前最关键的结构差异是：partition 既是运行扩展边界，也仍然是人物、
关系、空间和市场的语义边界。

本次收尾完成了一个 host 内的全局 Agent 目录，以及可恢复的跨 partition 对话事务。
这解决了“两个 partition 的人物完全互不可见、无法形成同源关系结果”的第一层问题，
但 canonical Agent planner 尚未自主发起跨区互动；共享市场、跨区迁移和统一前端也仍未完成。

## 本次已经完成

### Simulation-wide Agent directory

- `local-simulation-society-directory-v1` 从同一 runtime host 可见的全部 partition checkpoint
  动态生成内容寻址目录。
- 每个 Agent 映射到唯一 owner partition、owner event boundary 和有限公共状态。
- 目录不会复制余额、库存、身体状态等私有权威状态。
- 启动和读取时都会检查 simulation 内 Agent ID 全局唯一；重复身份 fail closed。
- canonical Agent provider 每个 tick 都能收到 `WorldDecisionContext.society`。
- 提供只读 HTTP 接口：
  - `GET /simulations/:simulationId/society/agents`
  - `GET /simulations/:simulationId/society/agents/:agentId`

主要实现：

- `apps/worker/src/localSimulationSocietyDirectory.ts`
- `apps/worker/src/localSimulationRuntimeHost.ts`
- `apps/worker/src/worldDecisionContext.ts`
- `packages/agent-runtime/src/worldDecisionContext.ts`
- `apps/api/src/societyDirectoryApi.ts`
- `apps/server/src/localRuntimeTownServer.ts`

### Cross-partition social interaction transaction

- 新增 `local-simulation-social-interaction-v1`。
- interaction 通过全局目录解析双方 owner，不把远端 Agent 复制为本地权威 Agent。
- 创建 interaction 前要求：
  - 双方属于同一 simulation；
  - 双方 owner partition 不同；
  - 两个 partition 位于相同 simulation-time boundary；
  - 双方在同一共享地点。
- 继续复用 canonical world conversation handler 计算自然语言会话、承诺信号、非对称关系
  增量和 STM 内容，没有另建一套社会结果算法。
- 同一个 `ConversationRecorded` 和双方 `SocialInteractionCompleted` outcome 会复制到两个 owner
  stream；每个 partition 只写入自己 Agent 的 `ShortTermMemoryRecorded`。
- 每个 partition append 使用稳定 idempotency key 和 expected stream version。
- runtime root 下的
  `society/social-interactions/operations.jsonl` 在任何 partition append 之前持久化完整 intent。
- 如果进程在第一方写入后崩溃，host 下次启动会在暴露 registry 前自动 roll-forward：
  event append 幂等重放、STM 补写、projection snapshot/checkpoint 更新，最后完成另一方写入。
- 重复提交相同 operation 不会增加 event、conversation 或 memory 数量；相同 operation ID 携带
  不同请求会 fail closed。
- 新增写入接口：
  - `POST /simulations/:simulationId/society/interactions`

主要实现：

- `apps/worker/src/localSimulationSocialInteraction.ts`
- `apps/api/src/societyInteractionApi.ts`
- `apps/api/src/httpApi.ts`
- `apps/server/src/localRuntimeTownServer.ts`

## 本次验证

已执行并通过：

```text
pnpm vitest run \
  apps/worker/src/localSimulationRuntimeHost.test.ts \
  apps/worker/src/worldDecisionContext.test.ts \
  apps/server/src/localRuntimeTownServer.test.ts

3 test files passed
25 tests passed
```

覆盖内容包括：

- 两 partition 全局目录、checkpoint 更新和 restart 稳定；
- 重复 Agent ID fail closed；
- canonical provider 收到全局目录且不泄露远端余额/库存；
- 跨 partition 会话的双 stream 持久化；
- 每个 owner 只物化自己的 STM；
- 相同 operation 幂等重放；
- 第一方 event 已写、memory/第二方未写时的重启 roll-forward；
- 真实 Node HTTP 请求后两个 projection 均出现同一个会话。

以下类型检查通过：

```text
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/server typecheck
```

`git diff --check` 通过。没有运行当前整个工作树的完整 `pnpm check`，因此不能把历史的全量
测试结果当作当前工作树验证结果。

## 尚未完成

### 统一社会闭环

- canonical social planner 仍然只从本地 projection 选择目标。现在的跨区 interaction 能力由
  service/HTTP 显式触发，尚未由 Agent 根据全局目录自主产生。
- Agent 的 deterministic trade、movement 和 social micro-planner 尚未真正消费远端候选。
- 多进程 collection owner 没有共享、可恢复的全局目录；当前目录和 interaction coordinator
  只覆盖一个 host 内同时可见的 partitions。
- 每个 partition 仍有独立 AMM pool、价格和订单执行路径；尚无 simulation-wide market authority。
- 同名地点仍是各 partition 的局部占用空间；没有全局容量、Agent owner transfer 或跨区迁移协议。
- 前端像素小镇仍读取单 partition projection；建筑人数不是全镇 authoritative occupancy。

### 论文功能与经验复现

- 真实外部 IdP、TLS 部署、MFA/撤销/恢复演练和真实参与者 cohort 尚未完成。
- 论文要求的成熟市场长跑数据、稳定窗口、40 万笔分析区块尚未形成。
- 市场统计、分层、轨迹和 ablation 的分析代码不能替代真实统一社会数据。
- 之前生成的资源探针、soak 和规模证据只说明旧运行拓扑的资源行为，不能证明论文社会功能
  已经对齐；不应继续作为功能开发主线。

## 已知边界与风险

1. interaction service 只串行化同一进程内的 interaction operation，没有跨进程 lease/fencing。
   如果 supervisor tick 与 interaction 同时推进同一 stream，会通过 expected-version 冲突
   fail closed，但还没有统一调度协议。
2. STM 恢复去重通过 owner 最近 64 条 memory 的稳定 record ID 完成。在“单 host 崩溃后先恢复、
   再启动 tick”的当前顺序下成立；分布式场景需要真正的幂等 memory materializer/inbox。
3. 两个 partition 都保存同源 conversation 和双向 relation outcome，它们是 operation journal
   的 materialized replica。未来多进程实现需要明确全局 social ledger 的唯一 authority 和
   replica cursor。
4. interaction journal 当前没有 hash chain、compaction 或跨进程锁。
5. HTTP route 经过现有 participant-access 外层控制器，但尚未设计 interaction 专属的
   Agent-owner 授权语义。它更适合作为后续 canonical planner 的内部提交端口，而不是直接公开。
6. HTTP 当前同步完成事务但返回 `202`；后续如果引入异步 coordinator，应返回 operation status
   查询地址；如果保持同步则应考虑改为 `200/201`。

## 建议的后续接手顺序

后续工作应继续沿论文功能依赖，而不是回到性能探针：

1. 给 agent-cycle dispatch 增加 simulation-level interaction intent seam，让 canonical planner
   能选择目录中的远端、共处 Agent，并由 coordinator 提交，而不是落入本地
   `unknown target agent`。
2. 将目录和 interaction journal 提升为跨进程 coordinator authority，增加 lease/fencing、
   inbox cursor 和幂等 memory materializer。
3. 建立 simulation-wide market ledger；partition 只提交交易 intent 并消费成交结果。
4. 建立全局地点占用和 Agent owner transfer 状态机。
5. 最后让前端读取 simulation-wide town projection，显示全镇建筑人数、跨区移动、关系和统一价格。
6. 上述功能闭环完成后再运行论文长跑、统计、ablation 和规模验证。

## 工作区状态

- 当前工作树包含约 320 个 modified/untracked 条目，是多轮论文对齐开发的聚合状态。
- 本次没有创建 commit、没有 stage、没有 push。
- 接手者不要用破坏性 reset 清理工作树；应先按模块审查并拆分提交。
- 本文件是一次性交接快照，不是动态任务追踪器。

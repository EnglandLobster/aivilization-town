# AIvilization Town 进度与交接快照

更新时间：2026-08-10
实现基线（不含本快照提交）：`658f4df`
发布目标分支：`feat/architecture-skeleton`
发布工作分支：`codex/publish-current-progress`

## 当前结论

仓库已经完成 AIvilization 论文功能对齐的主要**机制闭环**：层级规划、记忆与画像、自主社会经济循环、
统一结算 authority、全镇 Agent 目录、跨 owner 社交与移动、认知状态 handoff、统一社会投影、审计链和
部署健康契约都已进入默认本地运行路径。

当前不应再描述为“缺少跨区自主选择或 move handoff”。真正剩余的主线已经从功能接线转为两类验证：

1. **部署闭环**：多进程/多实例 coordinator、真实故障恢复、持续跨 owner 运行和生产监控验证。
2. **论文实证**：成熟市场长跑、分层与轨迹分析、消融重复实验、置信区间和论文结果直接对比。

因此，当前状态是：**默认路径的机制已基本闭合，但尚未完成论文实证复现，也没有建立生产规模结论。**

## 本次待发布范围

相对 GitHub `origin/feat/architecture-skeleton`，本地实现基线领先 14 个提交，共涉及 342 个文件：

- 统一社会与论文机制基线：`126dd3e`、`8908fe1`
- 区域市场和默认全局 authority：`df54c31`、`1a061b3`
- 全镇观测台与论文对齐矩阵：`a35bd86`
- simulation-level planner 远端目标选择：`37d24ac`
- 全局空间 move 结算与跨 owner runtime handoff：`7681393`、`c509485`
- authority 投影成为 UI/HTTP source：`ced5d63`
- owner-scoped 幂等记忆物化：`6cbfd82`
- 可验证 authority hash chain：`80ef862`
- 部署健康契约与跨实例账本接续验证：`658f4df`
- 配套文档、矩阵与工具产物隔离：`adfa98b`、`32b1c88`

## 已完成

### 1. Agent 认知与自主运行

- 层级规划、分支选择、动作修复、目标续期与重新规划已接入 canonical Agent loop。
- STM、LTM、profile、意图、计划和进度参与后续决策，并有持久化 trace/repository。
- 教育机会成本、招聘竞争、工资投影、福利、生产链、市场交易和社会关系均有实际运行路径与测试。
- human steering 进入持久化命令与认知链路，而不是只做 prompt 临时覆盖。

### 2. 全镇统一 authority 与市场

- `simulation-wide-authority-v1` 默认启用，使用 lease/fencing、稳定 operation fingerprint 和 durable inbox
  管理全镇结算；显式 `--simulation-wide-authority off` 才回退 legacy 分区路径。
- canonical trade/conversation 经单一 command router 进入 authority，再由幂等 materializer 写回 owner
  partition，避免 legacy 与 authority 双写同一交互。
- 默认市场把各 partition 同比例种子池合并为一个全局 AMM；Agent 规划、现价和价格指数读取同一权威池。
- 可选 `--regional-markets on` 支持一个 authority 下的区域异价与共处校验；这是仓库扩展，不能混入论文
  §4 单市场证据。

### 3. 跨 owner 社会与移动

- canonical planner 从 simulation-wide society directory 选择全镇范围内共处 Agent，不再局限于本地投影。
- move 经 authority 的全局空间视图执行容量、路线和在途时间结算。
- 跨 owner handoff 已实现：源 owner 捕获 `agent-cognitive-snapshot-v1`，authority 持有迁移状态，成对
  `AgentOwnershipDeparted` / `AgentOwnershipArrived` 事件迁移归属，目标 owner 以 first-write-wins 方式
  幂等恢复 STM、LTM profile、意图、计划和进度。
- owner-scoped 记忆 materialization 消除了跨区 STM 泄漏和恢复重放重复。

### 4. 统一观测、审计与部署契约

- society projection 直接读取 authority 的市场、空间和社会关系快照；观测台和 HTTP 展示同一全镇事实，
  per-Agent cognition 仍由 owner partition 提供。
- authority journal 是 genesis-anchored SHA-256 hash chain；启动和继续结算前 fail closed 校验，并提供离线
  verifier。
- 同一 durable root 上的 successor authority 可连续、幂等、单调地接续账本。
- `GET /runtime/daemon/status` 暴露 authority revision、fencing token、模拟时间、pending transfer/move 和
  partition keys，纳入 `production-runtime-slo-v2` 健康判断。
- 数据迁移、参与者数据生命周期、恢复演练、soak/resource evidence 和 systemd 部署样例已形成配套工具链。

## 2026-08-10 发布前验证

以下命令在实现基线 `658f4df` 上实际执行并通过：

```text
pnpm lint       通过
pnpm typecheck  13 个 workspace 项目通过
pnpm test       214 个测试文件 / 1247 个测试通过
pnpm build      13 个 workspace 项目通过
git diff --check  通过
```

这些结果证明当前代码的静态完整性、单元/集成测试和构建可用性，不等同于多实例生产验证或论文实证。

## 尚未完成

### P0 — 部署级闭环

- authority 仍是 file-backed 的单主机权威实现；尚未完成多进程/多主机 coordinator discovery、远程一致性
  存储或正式 leader failover。
- 需要在真实部署中验证 successor 接续、跨 owner move、inbox/materializer、恢复演练和 SLO 告警，而不只
  是测试中的跨实例对象接续。
- journal 尚缺 compaction、归档/远程 object-store backend 和长期容量治理。
- 外部 IdP、TLS、MFA、撤销流程和真实参与者 cohort 尚未完成端到端部署验收。

### P1 — 论文实证

- §4 成熟市场长跑、稳定窗口和目标交易规模的数据尚未产出；现有 dataset/analysis pipeline 只是可执行
  管道，短跑或合成 fixture 不构成复现。
- §4 分层/轨迹与 §5 planner ablation 需要声明模型、种子策略、重复次数、不确定度，并与论文结果直接
  比较。
- 万级/百万级人口与因果效应没有实测证据；不得由配置能力、单机测试或资源外推升级为规模结论。

### P2 — 工程增强

- 对 authority 长期运行增加 journal compaction、备份恢复验证和容量告警。
- 对同 tick 内市场读视图做语义评审：当前按 tick 采样一次，延续 legacy“本 tick 交易下一 tick 可见”的
  语义；若改为逐 Agent 实时采样，需要先明确确定性与公平性约束。
- 持续收紧 README、观测台和论文矩阵的证据分级，避免把 mechanism、pipeline、empirical、scale 四类
  证据混写。

## 建议后续顺序

1. 部署单主机生产形态，按 `docs/DEPLOYMENT_AND_RECOVERY.md` 完成备份、恢复、接续和 SLO 演练。
2. 再引入多进程/多主机 coordinator 与共享 durable backend，验证 fencing 和故障切换。
3. 冻结模型、场景、种子、重复次数与 compute 预算，运行成熟统一社会长跑。
4. 基于同一 provenance-bound 数据完成市场、分层、轨迹和消融分析，再判断论文复现程度。

## 证据边界

以 `docs/PAPER_ALIGNMENT_MATRIX.md` 为权威口径：

- **Mechanism verification**：状态转换、replay、幂等与 canonical wiring 有代码和测试。
- **Pipeline verification**：有来源绑定的实验产物可生成。
- **Empirical reproduction**：成熟数据、重复实验、不确定度与论文直接比较均成立。
- **Scale validation**：在声明硬件和人口规模上有持续测量。

当前可以确认前两层的大部分工程能力；后两层仍未完成。

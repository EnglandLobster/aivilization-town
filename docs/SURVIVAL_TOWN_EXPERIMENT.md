# Survival Town 100 承载力实验

`survival-town-100` 是当前用于观察真实社会现象涌现的最小闭环实验，而不是已经得到
实证结论的成品场景。它把自然资源、生产、食物获取、生理状态、幸福度、迁出和死亡放进
同一个确定性事件链，目标是让短缺、价格压力、职业分工、财富分层、迁移和死亡成为 Agent
行为与制度共同作用的结果。

## 运行

使用模型提供方：

```sh
pnpm --filter @aivilization/server start -- --profile survival-town-100
```

本地机制调试：

```sh
pnpm --filter @aivilization/server start -- \
  --profile survival-town-100 \
  --llm-mode deterministic
```

该 profile 为单分区 100 Agent 场景，并自动开启：

- `town-calendar`：日夜与被动能量/饱食度消耗；
- `town-carrying-capacity`：零投入初级品的有限区域库存和按小时再生；
- `town-survival-pressure`：饥饿造成健康损失和可审计死亡；
- `town-conditions`、`town-wellbeing`：让 Agent 看见生存处境及其生活质量；
- `town-lifecycle`、`town-migration`：老化、退休、死亡和不幸福迁出。

## 因果与守恒边界

初级生产必须先产生 `RenewableResourceRegenerated`（存在到期再生时）和
`RenewableResourceExtracted`，随后才能产生 `CommodityProduced`。资源不足会记录稳定的
`insufficient-renewable-resource` 拒绝；同一命令不会只抽取而不生产。

实验关闭两条会掩盖短缺的后门：生理救济不再直接创造 Apple，AMM 也不再自动从外部补充
商品。Agent 仍可通过 `AgentImportCommodity` 显式进口；进口按版本化镇外价格结算并与外部
部门交换货币，因此贸易依赖本身可以成为观察对象。

随机生理、疾病死亡、迁徙与天气均以固定模拟时间边界抽样：种子只绑定 run seed、策略版本、
主体和 cadence 边界，不绑定某次推进命令的 ID 或批量 `deltaMs`。每个机制拥有自己的 cadence，
不会被另一个更高频机制或更小的推进命令加速。因此把同一时间窗一次快进或逐 cadence 推进会
得到相同轨迹。新语义分别由 `stochastic-illness-v2`、`starvation-health-decay-v2`、
`town-lifecycle-v2`、`town-migration-v2`、`town-weather-v2` 标识；旧版天气、生命周期、
饥饿、迁徙和未版本化随机疾病配置保留兼容分支，历史事件仍按已记录事实回放。

## 观测口径

启用资源机制后，周期性的 `EconomicCompositionRecorded.survival` 记录：

- 当前存活人口、按死因累计死亡数、累计迁出数；
- 每个区域/商品的库存、承载上限和库存率；
- 累计抽取量与资源短缺拒绝次数。

这些字段与既有 Gini、食品价格指数、企业破产、存贷款和货币构成一起使用。第一轮长跑应
重点检查：食品库存率与食品价格的领先/滞后关系、低财富 Agent 的饥饿暴露、生产职业与进口
行为是否增加、迁出与 starvation death 是否集中在特定财富/教育群体，以及冲击后库存和
人口能否恢复。

## 当前限制

- 资源库存 v1 只允许单分区；多分区 profile 会在启动时失败，避免生成多个权威库存。
- 再生率是首轮实验参数，尚未经过长跑校准，不能声称已复现现实统计规律。
- 没有出生、家庭共享库存、空间农田/矿点、天气产量冲击和政府实物采购；救济食物将在
  采购/公共库存聚合落地后恢复。
- 当前完成的是机制与测量能力。是否真正涌现出短缺周期、阶层差异或迁移选择，必须由固定
  seed 的重复长跑和对照实验回答。

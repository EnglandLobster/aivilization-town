# 居民网约车 v1 验收

日期：2026-09-26。实现范围见 [Spec](RESIDENT_MOBILITY_V1.md)。

## 已实现

- 独立 mobility 领域：真实有限种子车辆、车主驾驶授权、司机登记/上下线、自主报价与撤回、乘客选单、排他预留、接客、上车、到达与取消。
- World 原子编排：固定车费托管，司机/乘客同路同时间旅行，实际到达后结算；出发前取消或到期全额退款。接客途中取消不瞬移车辆。
- 资金仍在既有 commerce 流通账户中守恒，专用押金不能由居民命令旁路结算；旧未启用出行的实验保留普通押金行为。
- 新 continuity 生活实验显式初始化一辆双座车（seed-car-1，第一位居民所有），不会自动开工；旧 manifest 保持关闭。
- 18 个新命令，累计 180 个命令、38 个分类、60 页 Skill；capability catalog v7、Skill v6，CLI envelope 仍为 v4。
- 生活上下文仍共享最多6条事项预算。查询分页和身份隔离，双方事实经历可检索；原文评价没有自动评分、摘要或排名。

## 验证

| 检查                                                    | 结果                                           |
| ------------------------------------------------------- | ---------------------------------------------- |
| 领域与 runtime 新增测试                                 | 10 项通过                                      |
| 全仓 `pnpm test`                                        | 2217 通过，1 跳过；300 个测试文件通过，1 跳过  |
| `pnpm lint`                                             | 通过                                           |
| `pnpm -r --sort typecheck`                              | 通过                                           |
| residents 及其依赖 build                                | 通过；最后改动后的 mobility/world build 亦通过 |
| Skill 校验                                              | 通过，生成页数60                               |
| `pnpm --filter @aivilization/residents verify:mobility` | 16 次真实编译 CLI 子进程调用通过               |
| `git diff --check`                                      | 通过                                           |

测试涵盖真实驾驶授权及撤销、司机步行不带动车辆、真实接客后载客返回、双人共同行程、目的地容量不足/余额不足无部分效果、双重占用拒绝、身份隔离、押金旁路拒绝、到期退款、大步/逐界时间推进等价、事件及完整 journal 重启回放。回放不会改动 journal 字节。

[CLI 结构化证据](evidence/RESIDENT_MOBILITY_V1_2026-09-26.json)来自身份绑定 HTTP 服务及独立 CLI 进程。未调用付费模型，此验收证明命令链路与世界事实，不证明居民会自发形成出行市场。

## 使用入口与限制

- `town wiki life/mobility.md`
- `town help vehicles` / `town help drivers` / `town help rides`
- `town rides list --scope open` 或 `--scope mine`

当前单司机、单乘客，沿用既有道路旅行时间，不承诺汽车速度优势。车辆买卖/生产、付费租赁、燃油维修、拼车、自动派单、公交地铁建设尚未实现。仅在开放居民单写入实验启用，未接入 canonical planner 或分区 authority。旧实验不自动升级。

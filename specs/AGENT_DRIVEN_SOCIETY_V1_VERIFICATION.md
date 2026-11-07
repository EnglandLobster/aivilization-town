# Agent 驱动社会元能力 v1：实施与验收

日期：2026-10-05。本记录只验收[协作元能力 v1 实施契约](AGENT_DRIVEN_SOCIETY_KERNEL_V1.md)，不是[社会总 Spec](AGENT_DRIVEN_SOCIETY_V1.md)全部能力的完成报告。整体剩余工作见[能力账本](AGENT_DRIVEN_SOCIETY_CAPABILITY_CONTRACTS.md)。下述测试统计属于该切片，不能用于证明后来扩展的能力已经通过。

## 已完成的能力

| Spec 项                  | 当前交付                                                                       | 主要实现                                                    |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| M01/M11 规则与发现       | 五类规则来源、14项规则说明、全部209项能力归属；世界假设/初始制度/居民权限分开  | `apps/worker/src/openSociety/rulebook.ts`                   |
| M02/M03 表达、通信、认知 | 复用既有原文、通信和个人记忆；新记录/程序原文按版本去重入经历                  | `readingExperiences.ts`、既有 information/memory            |
| M04 共同记录             | 自定有限字段、多人读写、当前 ACL、历史、撤下、双向确认交接；值不改变权威账目   | `packages/information/src/sharedRecords.ts`                 |
| M05/M06 同意与代理       | 原文提议保持独立；每个资源主体单独授权精确程序版本、runner、次数、期限；可撤销 | `packages/collaboration/src/programModel.ts`、`programs.ts` |
| M07/M08 资源与流程       | 转账、消息、共同记录 put/append 的有限组合；跨主体整体成功或整体不生效         | `apps/worker/src/openSociety/programExecution.ts`           |
| M09 时间协调             | 模拟时间、逐边界、同刻稳定顺序、取消、失败停止、推进预算与同刻准入检查         | collaboration programs、开放 runtime                        |
| M10 真实世界行动         | 保留既有生产、生活、住房、服务和出行领域；新流程不代理身体行为                 | 既有 world 入口及全仓回归                                   |
| M12 证据与观察           | 授权人/执行人归属、运行记录、个人有限经历、管理员原始观察、完整 journal 回放   | report/observer、runtime/state                              |

新增29条 CLI；当前共209条命令、43组、68页索引 Skill。生成器增加独立 `societySkill.ts`，不手工维护生成页。新实验启用；历史实验仅通过 `enable-society-kernel` 幂等 opt-in，不改写原 manifest。

## 工程验证

- 新增17项测试（共同记录3、流程领域5、runtime8、CLI结构化参数1）。
- 全仓测试：**2234通过、1项既有跳过；303个文件通过、1个跳过**。
- 全仓 lint、全仓 typecheck、residents 与依赖 build：通过。
- 生成 Skill 的入口长度、页面上限、所有链接和每个命令的索引由现有测试验证；JSON参数通过受限 town 命令执行器传递，不引入 shell 解释。
- 真实编译 CLI：**19次子进程调用通过**，包含预期拒绝的非零退出码。

主要业务断言：多主体分别同意、晚一步失败不留下先前付款、失败不消耗授权、撤权/过期/版本变更禁止执行、ACL交接即时生效、幂等不重复付款、真实执行者不冒充授权人、当前权限隔离、共同账目不改变余额、资金守恒、一次/分段时间推进等价、计划取消、重启只回放不重执行。

末轮审查补充了两个机制性保护：计划准入不能制造同一时刻超过推进预算的不可推进世界；成功执行记录必须包含每个主体的独立且不重复授权。规则目录也按具体 world 操作区分公共制度、住房和经济制度，不把所有 world 操作笼统归为经济。

结构化 CLI 证据：[AGENT_DRIVEN_SOCIETY_V1_2026-10-05.json](evidence/AGENT_DRIVEN_SOCIETY_V1_2026-10-05.json)。临时 CLI 测试世界在回放核对后清理，不触碰已有居民实验。

## 真实模型接入

隔离实验：`.local/open-residents/society-kernel-20261005`。OpenCode 1.18.34；模型 `opencode-go/deepseek-v4.1-flash`。

两名居民、三次明确提示的验收机会：第一人定义自己的共同记录和有限流程；第二人读取后以本人身份授予精确权限；第一人手动运行并建立一次模拟时间计划。程序中的原话由模型写，测试没有代替居民授权或补写领域效果。

三轮模型均正常结束。世界日志的7项检查全部通过：独立授权、恰好两次真实执行、双方实际余额变化、货币供给不变、两条归属准确的记录、两条带委托来源的原文消息、计划完成。关闭后重放状态一致且 journal 字节未改变。结构化证据包含实际命令数、时间、版本、会话 ID、journal 哈希和原文比对。

证据：[AGENT_DRIVEN_SOCIETY_MODEL_2026-10-05.json](evidence/AGENT_DRIVEN_SOCIETY_MODEL_2026-10-05.json)。原始 journal、公开模型输出、命令回执与凭据保存在被 Git 忽略的实验目录；公开摘要不含凭据或推理文本。

模型试验后仅调整了只读规则目录的分类说明；最终 CLI/全仓检查针对最终源码。模型结果证明这条新能力链路可由真实 Agent 使用，不证明它会在无任务提示时自发采用。

## 复现

```bash
pnpm --filter @aivilization/residents... build
pnpm --filter @aivilization/residents verify:society-kernel
pnpm check

# 需要已安装并认证的 OpenCode；必须指定新的实验目录
pnpm --filter @aivilization/residents verify:society-kernel:opencode \
  /absolute/path/to/a-new-experiment opencode-go/deepseek-v4.1-flash
```

居民入口：`town wiki society/index.md`、`town rules list`。管理员可用 `pnpm residents serve --root DIR` 查看 sharedRecords、coordination 和执行事件；管理员数据不会注入居民上下文。

## 仍然存在的限制

- 当前是独立开放居民的单写入 journal；没有把新能力接入 canonical planner 或分区 authority。
- 程序是有限结构化步骤，不支持任意脚本、条件循环、事件触发、自定义物理或任意公共强制执行。
- 共同记录是居民陈述；共享现金账户、新货币、完整土地制度没有被本轮虚构出来。
- 元能力 v1 的工程交付已完成；未实施的城市物理机制仍按各自 Spec 推进。
- 长期自由社会、无人提示的制度采用和城市规模尚未得到本轮证据支持。

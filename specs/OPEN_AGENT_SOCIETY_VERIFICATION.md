# Open Agent Society v1：实施与真实居民验收

日期：2026-09-25。对应 [Spec](OPEN_AGENT_SOCIETY_V1.md)。

## 1. 已交付的机制

| 能力          | 实现位置                                  | 行为边界                                                                                          |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 信息空间      | `packages/information`                    | 公共/私有空间，作者绑定，权限检查，修订冲突，删除历史，消息事件                                   |
| 自主认知      | `packages/memory/src/cognition.ts`        | 本人 belief/goal/note/self 更新；证据归属、置信度、版本检查；不能改写世界事实                     |
| 开放能力契约  | `packages/agent-runtime/src/openAgent.ts` | 47 个具名能力、严格参数校验、有界上下文/调用预算、驱动接口；不依赖 proposer                       |
| 应用与持久化  | `apps/worker/src/openSociety`             | 现有 world dispatcher、私有查询、经历归档、消息/提醒/活动唤醒、原子 journal、幂等请求、确定性回放 |
| OpenCode 接入 | `apps/residents`                          | CLI、身份绑定 HTTP/MCP、每人独立会话、真实模型记录、验收器、管理员观察页                          |

市民通过三个 MCP 入口 context/discover/invoke 访问能力。创建“点评站”“居民报纸”只需通用空间和文件，不需要再加一个对应业务工具。文件正文没有修改余额、产权、库存或位置的权限。

初始上下文包含本人状态、初始化背景、有界认知/经历/消息、可见人物与上次交接。完整历史通过 memory.search/read 获取；文件首次读取按“本人读到了这个版本”存档，重复读取同一版本不重复制造经历。信念引用可以指向本人的经历，世界事实、对方说法和个人解释保持区分。

世界命令沿用原来的经济、企业、信用、生理与空间规则。地方市场查询和交易使用实际区域，模型不能注入 actor、结算价格或教育效率。企业公开信息及本人企业经营状态可按需查询。

## 2. 真实 OpenCode 实验

驱动版本：**OpenCode 1.18.32**。成功模型：**opencode-go/deepseek-v4.1-flash**。

实验目录分别初始化；自由运行没有链路验收任务、没有预先写入其他实验的文档或消息。初始化背景使用显式模板，已经对“喜欢记录/探索”等偏好产生先验影响，不能把随后行为解释成无任何先验的自然现象。

| 实验               | 居民/机会数 | 能力调用 | 实际结果                                                                                                       |
| ------------------ | ----------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| 明确提示的链路验收 | 2 人 / 6 次 | 62       | 80 条提交；2 篇文档、6 条消息；双方真实移动并到达 restaurant；双方跨轮次读取、更新认知并等待                   |
| 独立自由运行       | 2 人 / 2 次 | 34       | 40 条提交；一人申请 Cleaner 工作并规划学习；另一人创建 town-voices 公共空间、写 2 篇文档并发问候；双方发起移动 |
| 首次 GLM 接入尝试  | 2 人 / 4 次 | 0        | GLM 完成部分 context/discover 调用后结束，未执行世界动作；保留为未通过记录                                     |

自由运行结束时模拟时间只有 2,000ms，两人的旅行都未完成，不能说已经抵达。工作申请只是 JobApplicationSubmitted，也不能说已经获得工作。

链路验收的 62 次调用中，有一次 files.create 因多传 expectedRevision 被拒绝。模型读取错误后删除多余参数并重试成功；没有脚本代为完成该动作。日志还记录了一个真实 TradeExecuted 事件。

所有三个实验中观测到的原生工具调用名仅为 town_context、town_discover、town_invoke。宿主 shell、文件读写、网页与子代理工具被 OpenCode permission 禁用；`--pure` 禁用外部插件。最终驱动使用仓库外的独立工作目录，避免继承项目指令。此处是 OpenCode 工具权限约束，**不是操作系统级恶意代码隔离**。

### 验收器的一处修正

首次验收器把“检索个人经历”错误地限定为必须调用 memory.search。第二名居民实际通过上下文中的引用调用了 memory.read，并在后续认知更新中使用了这些经历。这符合按需读取设计。

验收已改为认可 memory.search **或** memory.read；使用同一份不可变 journal 重新检查，未为此重新采样模型或补写居民动作。原结果保留在实验目录的 verification-initial-strict-search.json，复核后的 verification.json 为通过。另有回归测试确保“模型说计划行动、但没有事件效果”不能通过验收。

### 可核查证据

- [不含凭证的实验摘要](evidence/OPEN_AGENT_SOCIETY_2026-09-25.json)：每个实验的模型、会话 ID、调用数、世界事件类型、拒绝原因和 journal 尾部哈希。
- 完整链路：`.local/open-residents/verification-20260925/`。
- 独立自由运行：`.local/open-residents/free-20260925/`。
- 未完成的 GLM 尝试：`.local/open-residents/glm-incomplete-20260925/`。
- 各目录的 journal.jsonl 是权威效果；report.json/report.md 是观察报告；opencode/ 下是逐居民、逐机会的公开输出、工具收据和 usage 信息。推理事件不进入导出的居民报告。

## 3. 已修复的链路问题

1. **只说不做也显示“完成”**：驱动完成与效果验收分开；验收缺少持久效果时返回非零状态。
2. **互发消息让模拟时钟不前进**：自由运行每次机会推进版本化 cadence（默认 1 秒）；验收每轮还显式推进到最近活动到期。真实动作仍由世界调度完成。
3. **重复请求与重启**：相同身份/请求 ID/参数复用原结果，参数冲突拒绝；重放不再执行模型或再次转账。关闭旧实例不会解除新实例的锁，过期锁恢复经过互斥步骤。
4. **记忆泄露对方状态**：经历只记录参与者可见的结果字段，不暴露银行/其他账户完整账本。
5. **路途中仍被算作附近人物**：感知查询排除正在旅行的人，旅行者也不拥有出发地点的实时人物列表。
6. **公开文件被编辑后证据丢失**：读过的版本留在本人经历和文件历史；个人认知不能覆写它。

## 4. 复现与观察

```bash
pnpm install
pnpm --filter @aivilization/residents... build

# 两名真实模型居民，明确的链路测试
pnpm residents init --root .local/open-residents/my-check --count 2
pnpm residents run --root .local/open-residents/my-check \
  --mode verification --turns 6 --model opencode-go/deepseek-v4.1-flash
pnpm residents verify --root .local/open-residents/my-check

# 独立自由运行，不能复用链路验收目录作为无提示样本
pnpm residents init --root .local/open-residents/my-free --count 2
pnpm residents run --root .local/open-residents/my-free \
  --mode free --turns 6 --model opencode-go/deepseek-v4.1-flash

# 观察保存下来的实验
pnpm residents serve --root .local/open-residents/my-check --port 4320
```

OpenCode 需事先安装并认证；可通过 --opencode 指定可执行文件，通过 --model 使用自己的可用模型。实验失败会保留结果，不会自动改用脚本居民。

访问 http://127.0.0.1:4320，在页面中输入该目录 credentials.json 的 admin 值。每人凭证和管理员凭证不同；普通居民凭证不能访问 /admin/report，也不能切换身份。观察页为管理员全局视角，不是注入居民的上下文。不要把凭证放到提示词、URL 或 Git 中。

单个实验目录只允许一个 writer；使用 serve 时先停服，再执行 run/advance/call/verify。其余命令见 `pnpm residents --help`。损坏或截断日志 fail closed；不自动截掉历史尾部。如果恢复锁自身因恢复进程崩溃残留，需要操作员确认相关进程均退出后清理 writer.lock.recovery，再重放；不能绕过活跃 writer。

## 5. 工程验证

- **全仓测试：2127 passed，1 skipped**（已有 persona drift 实验跳过）。
- **pnpm lint：通过**。
- **pnpm -r --sort typecheck：通过**。
- 信息领域 12 项、认知 3 项、开放契约 2 项、运行时 10 项、传输/验收 4 项，共 **31 项新增测试**。
- 测试覆盖 ACL、作者绑定、冲突与删除历史、证据隔离、参数越权、消息、异步移动、忙碌拒绝、银行转账守恒、跨周期状态等价、幂等、崩溃锁恢复和损坏日志拒绝。
- 浏览器实际登录观察页，成功显示两名居民与工具轨迹，未发现浏览器运行错误。UI 文本通过 textContent 显示，避免把居民写入的内容当 HTML 执行。
- 两次真实模型实验分别在关闭后重新打开：80 条验收提交与 40 条自由运行提交均完整重放，重建的 report 与运行结束时保存的 report 逐字段相同。

公开包及 adapter 构建使用 `pnpm --filter @aivilization/residents... build`；本次所有相关构建产物和声明均通过。现有前端变更保留。

## 6. 当前范围与后续边界

这是**独立、单权威进程的完整实验入口**，不是把 canonical daemon 与开放模式的两套写路径混合。原有事件格式和默认生产路径未迁移；观察器也独立于主城 Pixi 界面。

当前记忆检索使用关键词、人物、时间和记录 ID，没有引入向量数据库或记忆 SaaS；初始化背景可解释且可变，不声称有真实遗传心理学；主观关系使用本人 cognition，不让模型任意改客观社会关系。食品“好吃”、遗传、复杂感官、居民编写可执行应用等没有被伪装为已实现的真实机制。

人口初始化当前限制为 1–50 人；journal 和检索在内存中运行，OpenCode 居民机会串行执行。这轮没有验证几万人吞吐、跨分区一致写入、长期社会稳定性或自然涌现的统计效应。后续扩展应以成本/延迟、认知质量、因果可追溯性和长期实验结果决定，保留这里的身份、领域校验与回放边界。

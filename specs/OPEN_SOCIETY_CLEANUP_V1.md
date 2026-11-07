# 开放居民社会清理 v1

日期：2026-11-06。依据 `OPEN_SOCIETY_DESIGN_PRINCIPLES.md`。

## 决定（项目负责人）

- 清理前的全部工作树已提交为快照：分支 `pre-cleanup-2026-11-06`，提交 `f2081d6d`。旧镇（老 992 次世界、E1–E4、试点）用这个提交仍然可以打开和回放。
- 清理在分支 `open-society-cleanup` 上进行。
- 不再兼容旧镇：新代码不必回放旧日志，可以删除迁移路径、旧版结构和兼容检查。
- 范围：先清理开放居民社会，以及只被它使用的领域代码。论文时期的规范运行时（分层规划器、tick、分区、全局权威、论文证据工具）另行决定。

## 现状

- `apps/worker/src/openSociety`：141 个源文件、约 2.45 万行；`runtime.ts` 3,641 行，其中约 1,900 行是 61 个 `enable*`/`upgrade*`/`register*` 方法，用来给已有的镇开启新功能。新镇的功能由 manifest 在建镇时一次给定，不经过这些方法。
- 能力目录 390 条，老世界里居民只用过 73 条。

## 分类（按三层原则）

| 类别           | 分组                                                                                                                                                                                                                                       | 处理                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 物理层         | city / travel / life（吃、用、睡、看病、醒来、停工）、education、market、bank、sources、production、stocks、housing、sites / construction / premises / materials                                                                           | 保留                                              |
| 居民自身与通信 | schedule、memory、cognition、messages、spaces、files、groups、notifications、blocks                                                                                                                                                        | 保留                                              |
| 通用制度积木   | offers / orders / payments / deposits、proposals / commitments、collectives / funds、governance、business（企业与工资条款）、registers / records / programs / mandates / rules、resources / principals（谁控制一样东西：个人、企业或集体） | 保留；principals 体量很大（2,264 行），以后再简化 |
| 写死的具体制度 | 见下面四组                                                                                                                                                                                                                                 | 待负责人确认后删除                                |

删除下面四组（2026-11-06，负责人授权由我按长期目标判断）。基建只保留三样：完整的物理层（身体、时间、空间、稀缺、生产、建造，以及待补的迁入、新产品、生命周期）；最少的通用制度积木（钱和转账、基于同意的约定、企业和集体两种组织及共同账户、谁控制什么、公共治理、共享记录和流程）；通信和记忆。其余具体制度都应由居民用积木自己搭，不再写死。

1. 交通与物流：rides / drivers / vehicles（306 行）、freight（542 行），以及 world 包里对应的居民模块。
2. 重复的交易和合约机制：trades（evidence trade，514 行）与 orders 重复；obligations（分期付款约定，260 行）；capital（股本协议，526 行），企业本身已有出资；permits（空间使用许可，499 行），房产的出入和使用授权已在 premises 中。
3. 生活服务类：services / bookings / queues / courses（694 行）、engagements（服务合同，646 行）、care / health / households / leases / civic / population（825 行）。家庭关系会在 B3 生命周期里按需重新设计。
4. 流程与社交的附加层：reactions（流程自动触发，478 行）、views（登记表统计，178 行）、feed / subscriptions（订阅和转发，192 行）。

## 步骤

1. 删除迁移路径：已有镇的 `enable-*`/`upgrade-*` 命令和运行时方法、对应的验收脚本和测试、`--legacy` 初始化、只为兼容旧日志存在的检查。逐个确认是不是新镇也要用的操作员动作（例如登记施工场地、安装城市应用）；是的话保留。
2. 按负责人确认的分组删除具体制度：能力目录条目、实现、能力边界、manifest 选项和策略、状态和应用器、上下文、Skill 页、测试，以及只被它们使用的 world 和领域包代码。每删一组，全量检查都必须通过。
3. 收拢配置：建镇只走一个当前的配置，删除不再需要的功能开关和历史配置表。
4. 更新文档：CLAUDE.md、AGENTS.md 中相关部分、Skill；记录删除了什么、为什么。

## 进度

- 第一轮（开放居民社会这一层）完成，2026-11-06：
  - 能力从 390 条减到 239 条，命令分类从 63 个减到 40 个。删除的组：交通与物流（rides、drivers、vehicles、freight）；重复的交易和合约机制（trades、obligations、capital、permits，以及 principal trade、resource sales、construction trade）；生活服务类（services、bookings、queues、courses、engagements、care、health、households、leases、civic、population，以及公共服务采购和商品采购）；附加层（reactions、views、feed、subscriptions）；世界里的请愿、公告、求助事项命令。
  - 一并删除：对应的工具实现、能力边界、manifest 选项和种子、上下文入口、Skill 页面、测试、验收脚本，以及 runtime 里的派发分支。runtime 不再经过"程序自动触发"层，提交直接写入日志。
  - 配置收拢为两个：`town-v1`（全部保留的功能，含私信节奏和计划层 v2）和 `town-interdependent-v1`（同一个镇，加上相互依存的经济）。`init` 默认就是 `town-v1`，去掉了 `--legacy`。
  - 修正一处回归：居民的待办提醒（群邀请、群消息、提议、订单、付款请求）原来挂在已删除的生活状态上，改为只要能通信就显示。
  - 生成 Skill 的脚本改为先清空目录再写，删掉的命令不会留下旧页面。Skill 升到 v79，能力目录升到 v69。
  - 全量检查通过：495 个测试文件、3,208 个测试。
  - 还没做的：world 包和各领域包里只服务于这些功能的代码（第二轮）；`enable-*` 迁移、按旧数据写的兼容检查，以及依赖它们的测试和脚本（第三轮）；Skill 正文改成平实的话（第四轮）。
- 第三轮（迁移路径）完成，2026-11-06：
  - 删除给已有的镇开启功能的全部迁移：runtime 中 61 个 `enable*`/`upgrade*` 方法和 `registerServiceFacilities`，社会分阶段启用模块，居民 CLI 中的 64 个 `enable-*`/`upgrade-*`/`install-apps` 命令，以及 17 个靠迁移验收功能的脚本。保留两项新镇也会用到的运营动作：`register-construction-site`（镇子扩地）和建镇时自动安装城市应用。`runtime.ts` 从清理前的 3,641 行减到约 1,600 行，`cli.ts` 从约 1,100 行减到 688 行，CLI 只剩 14 个命令。
  - 测试：只测迁移本身的 26 个测试删除；在迁移后还验证了真实行为的测试改成建镇时就带上该功能（休息中断、住房标准、公共住房规则、流程撤销、建筑主体），没有因为删除而丢掉行为覆盖。
  - 发现：工资条款（`business labor-terms` / `change-labor-terms`）只能通过迁移开启，任何配置建出来的镇都用不上，等于死代码；它也正是 C2 审查里雇人要多来回两次的原因。按"少量通用积木"的原则删除：招聘时写明工资，入职就是接受，这本身就是双方同意的约定。领域里对应的事件和类型留到第二轮。
  - 世界规则目录（`town rules`）删掉 15 条描述已删除制度的规则，规则是否适用改用一张表，替换原来 20 层嵌套的三元表达式；规则目录升到 v60。Skill 中所有"旧实验需运行者 enable-…"的说明删除。
  - 全量检查通过：493 个测试文件、3,174 个测试。
- 第二轮第一部分（开放居民社会的状态和直接依赖）完成，2026-11-06：
  - 开放社会的状态和应用器不再带生活、服务、登记表统计、订阅分发这几块；manifest 类型删除对应的策略字段（服务、分发、流程自动触发、统计视图）。建镇时的一致性检查拆到 `townConsistency.ts`，只检查保留的机制。
  - `information` 包删除登记表统计（record views）；`collaboration` 包删除流程自动触发（reactions）。资源控制只剩空间、登记表、群组三种信息资源。
  - 阅读记录（`readingExperiences.ts`）删除 11 个已不存在的读取能力，原来 15 层嵌套的三元表达式改为一个函数。
  - 居民 CLI 删除 distribution-verification 模式；管理员资源页删除已删除制度的分区；删除只验收已删除功能的 7 个脚本（空间许可、建设交易两个、生活服务两个、服务雇佣、服务供给），另外 3 个脚本去掉其中涉及已删除功能的步骤。
  - 全量检查通过：491 个测试文件、3,161 个测试。
  - 下一步（第二轮其余部分）：world 包和领域包中只服务于已删除制度的代码，约 2 万行。房产使用权（许可和供给）也在删除范围内：现在没有任何能力能创建许可或供给，但每个时间步仍在结算。人口离开和继承目前也不可达，但保留，作为 B3 生命周期的基础。

# 城市模拟机制差距盘点（对标 Cities: Skylines，目标 AI-native 超越）

盘点日期：2026-08-30
基线：当前 `main`（含 survival-town-100 承载力实验）
目标定义：机制上达到城市天际线（Cities: Skylines，下称 CS）级的城市系统动力学，
并以 LLM 市民的认知/社会能力实现 CS 做不到的 AI-native 涌现。

## 现状定位

- **市民层已超越 CS**：CS 市民只是路径点；本项目 Agent 有层级规划、双过程记忆、
  社会关系演化、24 小时作息日程（`packages/agent-runtime/src/dailyPlanning.ts`）；
  `PerStageContextView` 已按排序、行动、对话、反应、重规划等阶段裁剪 LLM 输入，
  salience 仅投影生存阈值、活跃意图、高重要度记忆和 eligible rules，视图版本与
  实际可见段进入 trace/manifest，不再把完整世界 JSON 倍乘注入每个阶段。
- **城市层仍未达到 CS**：全镇仍是固定地点抽象图（`packages/content/src/locations.ts`），
  没有建造、区划与实体物流；需求驱动迁入已形成最小闭环，区域地价、财政、生命周期、服务质量和
  治理杠杆已经形成可回放闭环。当前最大差距转向空间形态与多层系统的可视化反馈。
- 已有基础：AMM 市场 + 22 条生产链（24 种商品 5 tier）、职业/教育/住宅/工资/福利制度、
  三维生理、社会信号提取（v1 关键词 / v2 标签 / v3 强度）、统一 authority 结算、
  运维级观测台。

## 差距分层清单

### A. 空间与城市形态（最大差距）

- 现状：地点为图节点（`packages/world/src/projection.ts` `WorldLocationState`），
  `mapPosition` 仅供渲染；Agent 已有独立于当前位置的持久 `residenceLocationId`，住宅容量按
  真实居所占用，Agent 可自主选择空置住宅，迁入者由权威确定性分配具体空位，维护费按居所
  区域地价而非临时活动地点计价。`town-construction-v1` 可消耗真实材料扩充住宅容量；仍无
  地块、房产所有权、租约或建筑 condition 实体。
- CS 级需求：zoning（住宅/商业/工业分区）、建筑随需求生长/升级/废弃、
  地价系统（区位/服务覆盖/环境定价）、可建造路网。
- AI-native 加成：Agent 自主决定开店/买地/建房，城市形态成为社会涌现结果。

### B. 交通与物流

- 现状（2026-08-31 更新）：边有基础 travel time；`town-spatial-graph-v2` 用权威全镇
  在途路线统计有向边并发流量，按拥堵后耗时选路，再叠加目的地占用压力。路径、边流量
  快照、策略版本和最终耗时冻结进事件，Agent 决策上下文用同一算法和 authority 在途表
  估算各目的地成本。交易仍瞬时完成，货物无物理位移。
- 缺：载具/公共交通、实体货物流（原料→工厂→市场的位移与仓储）。
  物流使"区位"真正产生价值，与 A 层联动。

### C. 基础设施与公共服务

- 现状（2026-08-30 更新）：学校/诊所的区域容量与实际预算已驱动服务质量，并反馈学习、
  治疗、幸福感和地价；P6 公共预算命令可改变这个反馈环。
- 仍缺：个体排队/覆盖路径，以及水电污水、警消防、犯罪和火灾系统。

### D. 人口生命周期与心理

- 现状（2026-08-15 更新）：**生命周期最小集已落地**（flag `town-lifecycle` 默认关）——
  年龄阶段（adult→elderly，child/teen 预留给未来生育机制）、预掷寿命老死
  （seeded RNG 派生，任意时刻可重推导）、低健康病死、强制退休（释放企业职位 +
  treasury 养老金转移）、死亡清算（贷款冲销/存款没收/流通余额销毁）。
  幸福感权威状态变量（`town-wellbeing`）与昼夜日历 + 生理被动衰减
  （`town-calendar`）亦已落地。
- 2026-08-30 更新：`town-survival-pressure` 已把持续饥饿确定性地转换为健康损失和
  starvation death；死亡沿用完整遗产清算。幸福度驱动的迁出也已落地。
- 2026-08-31 更新：`town-migration-v3` 已按住房空置（硬上限）、岗位空缺和平均幸福度
  在 simulation-wide authority 上逐日结算迁入；新 Agent 使用确定性 ID，均衡分配到 owner
  partition，初始余额经 monetary-authority→Agent 交易进入 moneySupply，并随事件回放。
- 仍缺：出生/家庭/household（S4 缓做）、殡葬/丧亲、迁入家庭/教育层结构，
  以及病死率对医疗服务质量的连续联动。
  （2026-08-14 更新：CS2 拆包证实幸福感是其社会模拟总线——驱动迁出/犯罪/毕业，
  见 `docs/reports/CS2_SOCIAL_AND_GAMEPLAY_GAP_ANALYSIS.md` P1/P3。）

### E. 宏观治理与财政（最小玩法闭环已落地）

- 现状（2026-08-30 更新）：`SetTaxPolicy` / `SetPublicBudget` / `SetSubsidyPolicy`
  已形成版本化、可回放的镇级治理命令面（`--town-governance` 默认关）。operator 可直接施政；
  人类居民与 LLM Agent 必须使用本人已签署、达到阈值且主题匹配的请愿，每份请愿只授权一次变更。
  最终政策事实由 simulation-wide authority 原子结算并广播，projection-backed policy resolver
  让后续税收、公共预算和安全网统一使用已通过的政策；政策变更本身不移动资金。
- 仍缺：区域政策、区划、选举/任期与更完整的公共协商；前端也尚无治理控制台和政策效果面板。
  最小闭环已把参与者玩法从"指挥我的 Agent"提升到"治理全镇"。

### F. 环境动态

- 现状（2026-08-30 更新）：世界昼夜相位与生理被动衰减已由 `town-calendar` 结算；
  7 种天气 Markov 链（`packages/world/src/weather.ts`）已接入 soaked/cold 与前端图层。
  `town-carrying-capacity` 为全部零投入初级配方增加区域库存、承载上限、确定性再生与
  原子抽取事件；库存不足会拒绝生产，Agent 使用同一可用量函数规划。该实验关闭凭空
  发放食物的生理救济和自动外部市场补库存，只保留有成本且可审计的显式镇外进口。
- 仍缺：多分区统一资源 authority、营业时段联动、季节/天气对产出的影响、空间资源节点、
  污染和偶发灾害。

### G. 公共话语与制度涌现（AI-native 超车点，CS 完全没有）

- 现状：（2026-08-14 更新：已有突破）镇级公告频道 `AgentPostBulletin`/`IssueTownBulletin`
  （`packages/world/src/bulletin.ts`，高优先级抢占反应）、社会事项 help-request/commitment
  多人响应-裁决生命周期（`packages/world/src/matters.ts`）、冲突目击者态度传染
  与自主 confront/attack/intervene 闭环（`town-conflict-v2`，flag 默认关）。信息/谣言沿
  社会网络的 hearsay 传播和请愿阈值集体行动也已落地。
- 仍缺：规范与法律形成、集体行动深化（罢工/抗议/选举）、
  持久群组/公共讨论版。本项目架构（LLM 市民 + 社会记忆 + 权威结算）天然适合，
  是"更 AI-native"的实证支撑。

### H. 前端体验

- 现状：（2026-08-14 更新）观测台已重构为活城画布：tilesheet 渲染 + agent 移动插值 +
  点选 + 天气图层（`apps/web/public/ui/map/`），5 个 drill-down workspace + inspector。
- 仍缺：地价热力图、需求条、事件流 ticker。

## 经济系统改造进展（2026-08-13，已落地）

对标 Cities: Skylines II 反编译分析（`docs/reports/CS2_ECONOMY_SYSTEM_ANALYSIS.md`、
`docs/reports/CS2_VS_OUR_ECONOMY_COMPARISON.md`），E 节（宏观治理与财政）已从零推进到基本闭环，
全部按 `docs/ECONOMY_DDD_ARCHITECTURE.md` 的 DDD 边界落地：

- **货币会计闭环**：mint/burn/transfer 三分类不变量（`packages/world/src/moneyAccounting.test.ts`），
  工资/住宅升级/维护/医疗/教育全部归入口径；`packages/economy/src/accounting.ts` 复式记账。
- **行为后果**：住宅欠费 arrears 累计超阈 → 强制降档（`society/residential.ts` `evaluateResidentialArrears`）。
- **税收与财政**：工资累进税 + 交易税 + 分红税（`society/tax.ts`）；公共财政池 treasury
  （补贴、公共预算、公共工资从池出，池赤字则打折——agent 可感知"政府欠薪"）。
- **企业层**：新 bounded context `packages/enterprise`——创办/注资/招聘/欠薪/裁员/分红/
  偿付宽限/破产清算；企业作为主体参与 AMM 交易与出口；`AgentWork` 工资由雇主账户支付。
- **金融**：新 bounded context `packages/credit`——镇银行存款计息、贷款真实还本付息、
  违约信用记录、准备金约束。
- **镇外贸易**：滚动贸易平衡 + √balance 冲击定价（`economy/externalTrade.ts`），
  出口=注入、进口=销毁，货币政策阀门成立。
- **贫富分化**：lifestyle 四档（`society/lifestyle.ts`）+ 拮据档非生存消费护栏。
- **观测**：每 tick `EconomicCompositionRecorded`（货币部门构成、企业统计、Gini、存款/贷款余额）。
- **性能**：时间型结算可选分帧摊销（`timeSettlementAmortization`，canonical 默认关）。

剩余缺口：A 空间/建造、B 交通物流、出生/家庭、人口分层迁入及更完整治理制度。
E 的税率/预算/补贴已经是参与者和合资格 Agent 可调的权威命令。企业加入/注资、银行贷款与
企业侧外贸已有 deterministic proposer；2026-08-31 已补齐不依赖 model API 的内生企业闭环：
确定性创办者选举 → 企业生产/销售 → 有销售与工资准备金后招聘 → 员工由企业发薪。
仍缺的是需求驱动的企业品类分化、竞争性退出后的再创业，以及更丰富的 LLM 经营策略。

### 教育体系进展（2026-08-14，已落地）

- **离散六级轨道**（`society/educationSystem.ts`）：0 未受教育 → 1 小学 → 2 初中 →
  3 高中 → 4 大学 → 5 研究生；小学/初中为九年义务教育，学费由公共财政池
  （treasury）承担、货币供给不变（`EducationCompulsoryFeeCovered`），高中阶段普职分流
  （普高/中职 track，`vocationalTrackShare`）。
- **中考/高考/考研放榜制**（`society/educationExam.ts`，E2）：按 cadence 周期结算，
  分位数划线（`admissionQuotaByLevel`），周期事件记录报考/录取/切线；义务教育段内
  仍自动晋升，3-5 级一律考试闸门。
- **中职就业加成**（E3）：中职 track 报技能型职业按职级加有效教育分
  （`evaluateEffectiveEducationScoreForOccupation`），招聘资格与雇主排序一致使用。
- **生产力教育乘子**：生产效率按离散等级乘子结算（economy production efficiency），
  教育回报真实反映到产出。
- **理性投资上下文**：决策上下文给出等级/阶段标签/义务教育缺口/下次考试竞争与
  录取率/教育回报（`worldDecisionContext.ts`），agent 可感知升学成本收益。
- **LLM 自主报考**：考试报名进入 LLM 动作白名单与 proposal union。
- **观测**：每 tick `EconomicCompositionRecorded` 新增 `educationDistribution`
  （0-5 级人数，缺省等级按 score 派生，与 E1 兜底语义一致）。

剩余缺口：儿童年龄阶段（无年龄概念，新生 agent 直接成人）、学校建筑与容量约束、
教师雇员（教育目前无劳动力投入）——均依赖 GAP A（空间/建造）与 D（人口生命周期）先行。

### 公共话语进展（2026-08-15，P4a 已落地）

- **P4c 幸福感三消费端**：考试录取快照加成（education-system 可选
  wellbeingExamScoreBonus ±10 分，资格线仍按原始分）、冲突 strained-relation
  门槛平移（town-conflict 可选 wellbeingGrievanceShift 0.2，困顿者易怒）、
  拮据档非生存消费上限 ×[0.5,1.5] 调制（读路径）。全部可选字段，flag 关闭
  时逐字节兼容。
- **P4a hearsay 记忆传播**（`--town-discourse`，默认关）：`society/discourse.ts`
  纯决策——对话每个方向以 40% 概率把说话者一条合格近期记忆传给听者，
  重要度在 ×[0.7,1.3] 内按种子 roll 失真，hearsay 链深 3 跳后不再转述
  （谣言自然衰减）；implanted/corrected/doubtful/past 永不传播。world 在
  对话结算时以 ShortTermMemoryRecorded 事件落地（provenance=hearsay，
  memory 检索已内建 hearsay 降权）；roll 仅由命令封套+时钟派生，replay
  可重推导。候选来自 projection 的 256 条近期记忆读缓存（明确非权威库）。

### 人口流动进展（2026-08-31，S5 最小闭环已落地）

- **幸福驱动迁出**（`--town-migration`，默认关）：CS2 NotHappy 多项式形状
  （幸福 ≈48 处过零，wellbeing 0 峰值 ~14%/h，策略上限默认 1%/h），逐
  cadence 种子 roll；离场清算与死亡共享全套路径（企业职位释放、贷款冲销/
  存款没收、流通余额销毁出镇经济、未决申请/事项取消）。无 settled
  wellbeing 时按 fallback 50（中性）——不开 town-wellbeing 的运行零迁出，
  互锁显式。
- **需求驱动迁入**（同一 flag）：`society/migration.ts` 纯计算真实居所占用形成的住房压力、
  岗位压力与 wellbeing 吸引力；住房容量是硬上限，fractional arrival 使用
  cadence+simulation seed。authority 按跨越的每个日边界逐次决策、选择具体住宅空位、登记、
  分配 owner 和投递，`AgentRegistered` 冻结居所、分配策略版本与需求快照。重复 operation
  幂等，跨分区初始资金贡献同步更新。

### 集体行动进展（2026-08-15，P4b-1 请愿最小集已落地）

- **请愿集体行动**（`--town-collective-action`，默认关）：`society/collectiveAction.ts`
  纯阈值规则（签名数 ≥ 阈值，默认 3 含发起人）；`AgentRaisePetition`/
  `AgentSignPetition` 命令在权威上结算（全镇共享真相，事件投递到全部分区），
  签名聚合跨阈值即刻触发全镇 `PetitionThresholdReached`（恰一次，观测 +
  并已成为 P6 居民治理命令的授权输入）；未达阈值的公开请愿 3 模拟日后过期。
  决策上下文暴露未签请愿（最新 8 条）；社会域确定性提案（未签即签、
  幸福感 < 20 可发起）把两个命令放进 LLM 动作面。**罢工等触碰账本的
  集体行动刻意缓行**，待账本冲击论证（路线图 P4b 第二步）。

### 服务短缺进展（2026-08-30，P5 已落地）

- **区域服务质量**（`--town-service-quality`，默认关）：`society/serviceQuality.ts`
  以版本化纯策略把当期实际公共拨款、学校/诊所容量与权威全镇占用转换为教育/医疗
  质量；跨多个 cadence 逐边界结算为 `RegionalServiceQualityUpdated`，projection 仅回放
  最终事实。该结算只在 simulation-wide authority 执行，事件广播到所有分区。
- **行为与城市反馈**：已结算质量直接折算学习增益和治疗恢复；两类服务取均值后作为
  幸福感的有符号因子及区域地价的非负贡献，避免因未来增加服务种类而扩大总权重。
  Agent 决策上下文暴露所在区域及教育/医疗质量；manifest/provenance 与 CLI/env 开关同步。

### 治理命令面进展（2026-08-30，P6 已落地）

- **有界治理聚合**（`society/governance.ts`）：税率、公共预算与安全网补贴分别记录完整最终政策、
  governance revision、稳定拒绝原因和授权来源；领域决策为纯函数，事件 replay 不读取当前默认值。
- **双入口与一次性授权**：operator steering 命令无需冒充 Agent；居民 human/LLM 路径要求已签署、
  达阈值、主题严格匹配的请愿，并在成功事件中消费 petition id，防止重复授权。revision 乐观并发
  避免两个并行提案静默覆盖。
- **authority 与账户边界**：三类命令统一路由至 simulation-wide authority 并广播全部分区；
  `GovernancePolicyChanged` 不改余额、treasury 或 moneySupply，真正资金流仍由既有税收/预算 cadence
  使用复式记账结算。
- **Agent 与运维闭环**：决策上下文升级为 v9，仅暴露本人有权执行的最新 8 份请愿；canonical
  governance micro-planner、reactive repair whitelist、人工 steering trace、CLI/env、manifest 与
  provenance registry 同步。flag 关闭只禁止新治理命令，不改变历史已生效政策的 replay 语义。

### 社会模拟总线进展（2026-08-15，P1–P3 已落地）

对标 `CS2_SOCIAL_AND_GAMEPLAY_GAP_ANALYSIS.md` §4 的 P1–P3，三阶段全部按
"flag 先行 → 确定性/replay/幂等三关 → authority 结算"落地，默认全关：

- **P1 幸福感权威状态变量**（`--town-wellbeing`）：`society/wellbeing.ts` 纯决策函数
  （目标 = baseline + Σ因子，按 convergencePerHour 收敛，到步长 snap 定点停止发事件）；
  world 在 time settlement 逐区间结算 `WellbeingChanged`（读取当 tick 最新
  生理/安全网/欠费/生活方式/关系输入）；决策上下文暴露 value+band。
- **P2 昼夜日历 + 生理被动衰减**（`--town-calendar`）：`society/calendar.ts` 纯函数
  相位时钟（整毫秒相位网格、半开窗口枚举）；`TownDayPhaseChanged` 逐相位事件；
  energy/satiety 线性被动衰减（floor 0，严格可加）先于 wellbeing 同 tick 结算。
- **P3 生命周期最小集**（`--town-lifecycle`）：年龄阶段（预掷寿命由 agentId+seed
  派生，任意时刻可重推导）、老死/病死（CS2 病死率二次方形状）、强制退休
  （企业职位释放 + treasury 养老金转移，无国库切片时铸造）、死亡清算
  （credit 领域新增 `decideLiquidateDeceasedCustomer`：贷款冲销/存款没收均为
  纯账面操作、moneySupply 不变；流通余额销毁入 external/death-estate、
  moneySupply 等额下降；未决求职/考试申请与未决事项随死亡取消）。
  账本冲击论证：死亡是 AGENTS.md §7 第 3 类"移出流通"；跨分区所有权转移
  携带 lifeStage/retiredAtMs。

### CS2 社会/游戏机制拆包对比（2026-08-14，新增）

基于 `tools/cs2/decomp` 全量反编译，经济/教育之外的两块——**市民社会模拟**与**城市游戏机制**——
已逐项对比并给出落地方案，详见 `docs/reports/CS2_SOCIAL_AND_GAMEPLAY_GAP_ANALYSIS.md`：

- CS2 社会模拟的枢纽是**幸福感/福祉权威状态变量**（26 因子目标值收敛），驱动迁出/犯罪/毕业；
  我们目前只有派生条件标签（`society/conditions.ts`），这是下一步第一优先级（新文档 P1）。
- CS2 城市层的核心是**需求公式→建造→地价→税收**负反馈环；我们的入口是"需求信号→人口流动"，
  排在生命周期落地之后（新文档 P7）。
- 生命周期的死亡模型（预掷寿命曲线）与我们的 seeded RNG 天然兼容（新文档 P3）。
- 公共话语（信息传播/集体行动）是 CS2 完全没有的 AI-native 超车点，已有公告/事项/冲突基础
  （新文档 P4）。
- 不建议照搬：XP/里程碑/发展树、玩家金库四本账、电水图流、车道级交通（新文档 §5）。

## 推进顺序建议（按 ROI，尊重确定性 event-sourcing + authority 三关：确定性/replay/幂等）

> 2026-08-14 起以 `CS2_SOCIAL_AND_GAMEPLAY_GAP_ANALYSIS.md` §4 的 P1–P8 为准
> （P1 幸福感 / P2 昼夜日历 / P3 生命周期 / P4 公共话语 / P5 服务短缺 / P6 治理命令面 /
> P7 需求与人口流动 / P8 空间建造物流）。
> **2026-08-31 进度（按 ROI 重排）：P1–P3、P4a/P4c、P4b-1（请愿）、P4d（自主冲突）、S5 双向人口流动、
> P5 服务短缺与 P6 治理命令面均已落地；随后优先补齐了生存承载力纵向切片
> （有限资源→生产→食物→生理→迁出/死亡→实验指标），并完成住房/岗位/幸福度→迁入→
> Agent 注册/分区/资金的 P7 最小闭环。下一项是长周期校准，再进入空间建造物流。**
> **2026-08-31 P8 起步：`town-construction-v1` 已形成最小住宅供给反馈——全镇人口/有限
> 住宅容量产生占用压力，具备材料的居民通过 authority 消耗真实 Wood 扩建容量，容量事实
> 广播到所有分区并继续影响迁入上限。地产所有权、租金收益、建筑 condition/废弃和实体货运
> 仍是 P8 后续，不在这一刀中伪造。**
> **2026-08-31 P8 交通切片：`town-spatial-graph-v2` 已完成边流量拥堵最小闭环——每个未到达
> 行程在其冻结路径的每条有向边贡献一个并发单位，后续移动按 BPR 形状的有界延迟重新选路；
> simulation-wide authority 统一结算跨分区流量，Agent 可见同源路线估价。未引入车道、载具或
> 虚假的实体货运。**
> **2026-08-31 P8 居所切片：`residential-assignment-v1` 将“家”从当前位置与住宅品质档位中
> 分离。选择居所和迁入占位均在 simulation-wide authority 上串行校验，最后一个空位不会被
> 跨分区重复占用；Agent 规划上下文可见真实占用/空置，住宅维护费始终按家所在区域计价。
> 旧事件/快照继续采用兼容回退，不改写历史语义。**
> 以下为原始排序，保留作历史脉络：

1. **F 昼夜/日历 + D 生理被动衰减**：小改动，小镇立刻"有日子过"。
2. **G 公共频道 + 信息传播**：纯增量系统，AI-native 差异化最大，不与现有机制冲突。
3. **E 治理杠杆 + 财政循环**：把既有常量政策外露为命令，水到渠成；参与者玩法升维。
4. **D 生命周期 + 幸福感**：让社会真正有代际；需先论证人口流动对 authority/账本的冲击。
5. **A 空间/建造 + B 交通物流**：最大工程；落地后"城市天际线"名副其实。
6. **H 前端**：随 A/B 同步演进。

## 证据边界（必须守住）

> 项目已于 2026-08 超越论文阶段独立发展：论文不再是北极星，本文档是现行 roadmap。
> 以下规则去除了论文锚点，但纪律全部保留。

- 新机制（如本清单 A–H）参照 `--regional-markets` 先例做成**显式开关**先行，
  由证据推动晋升进 canonical 默认路径；长跑实证必须声明当时激活的 flag 集。
- 口径以 `docs/PAPER_ALIGNMENT_MATRIX.md` 定义的四类证据分级为准：
  mechanism / pipeline / empirical / scale 不得混写。
- 每个新系统落地前需通过确定性、replay、幂等三关，并进入统一 authority 结算路径。

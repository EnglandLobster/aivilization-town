# 城市模拟机制差距盘点（对标 Cities: Skylines，目标 AI-native 超越）

盘点日期：2026-08-10
基线提交：`7d8915a`（含 LLM 社会信号提取器）
目标定义：机制上达到城市天际线（Cities: Skylines，下称 CS）级的城市系统动力学，
并以 LLM 市民的认知/社会能力实现 CS 做不到的 AI-native 涌现。

## 现状定位

- **市民层已超越 CS**：CS 市民只是路径点；本项目 Agent 有层级规划、双过程记忆、
  社会关系演化、24 小时作息日程（`packages/agent-runtime/src/dailyPlanning.ts`）。
- **城市层远未达到 CS**：全镇为固定 7 个地点的抽象图（`packages/content/src/locations.ts`），
  无建造、无分区、无地价、无财政、无生命周期。CS 的本体——多层耦合系统动力学
  - 治理杠杆 + 可视化反馈——几乎空白。
- 已有基础：AMM 市场 + 22 条生产链（24 种商品 5 tier）、职业/教育/住宅/工资/福利制度、
  三维生理、社会信号提取（v1 关键词 / v2 标签 / v3 强度）、统一 authority 结算、
  运维级观测台。

## 差距分层清单

### A. 空间与城市形态（最大差距）

- 现状：地点为图节点（`packages/world/src/projection.ts` `WorldLocationState`），
  `mapPosition` 仅供渲染；住宅只是 Agent 身上的 `residentialTier` 数值，无地块/房产实体；
  `zoning|construct|building` 在模拟代码中零命中。
- CS 级需求：zoning（住宅/商业/工业分区）、建筑随需求生长/升级/废弃、
  地价系统（区位/服务覆盖/环境定价）、可建造路网。
- AI-native 加成：Agent 自主决定开店/买地/建房，城市形态成为社会涌现结果。

### B. 交通与物流

- 现状：边为固定 travel time（Dijkstra 最短路，`packages/world/src/spatial.ts`）；
  拥堵系数只看目的地占用率（+50% 封顶）；交易瞬时完成，货物无物理位移。
- 缺：边流量拥堵、载具/公共交通、实体货物流（原料→工厂→市场的位移与仓储）。
  物流使"区位"真正产生价值，与 A 层联动。

### C. 基础设施与公共服务

- 现状：学校/诊所为地点 + 制度模块；无覆盖/短缺动力学；水电污水、警消防、
  犯罪/火灾全部为零。
- 缺：服务容量短缺 → 排队/质量下降 → 地价与幸福感反馈环。是治理杠杆（E）的作用对象。

### D. 人口生命周期与心理

- 现状：人口固定（仅注册/迁出）；无出生/衰老/死亡/家庭（grep 零命中）；
  无可模拟幸福感状态变量（`mood` 仅为记忆画像反思类别）；
  energy/satiety 不随时间被动衰减，仅劳动消耗。
- 缺：生命周期（成长→上学→工作→退休→死亡）、家庭/household、人口迁入迁出、
  幸福感/满意度指标。论文 §4.4 分层长跑的成熟社会也需要人口更替。

### E. 宏观治理与财政（玩法层缺失）

- 现状：steering 仅限单 Agent（`SetLongHorizonObjective`/`IssueReactiveCommand`）；
  命令层无 `tax|budget|zoning|district`（零命中）；安全网/教育费率/工资政策为代码常量
  （`packages/content/src/scenarios.ts`），非人类可调。
- 缺：税收→财政→公共支出循环、镇级政策命令（税率/补贴/区域政策/服务预算）、区划。
  同时是参与者玩法升维：从"指挥我的 Agent"到"治理全镇"。

### F. 环境动态

- 现状：时钟为单调毫秒数（`packages/sim-core/src/time.ts`），世界层无昼夜日历
  （昼夜仅在 Agent 日程层）；无天气/季节/灾害/污染；初级资源凭空产出（`inputs: {}`），无储量；
  唯一外生冲击为 per-agent 随机疾病（1%/小时）。
- 缺：世界时钟层昼夜与日历（营业/作息联动）、天气季节影响生产、资源节点与枯竭、
  偶发灾害。昼夜是成本最低、城市感最强的一项。

### G. 公共话语与制度涌现（AI-native 超车点，CS 完全没有）

- 现状：社交仅点对点对话；无广播/公告/媒体/公共频道（grep 确认）。
- 缺：镇级公共频道（公告板/广场演讲/报纸）、信息与谣言传播模型、规范与法律形成、
  集体行动（罢工/抗议/选举）。本项目架构（LLM 市民 + 社会记忆 + 权威结算）天然适合，
  是"更 AI-native"的实证支撑。

### H. 前端体验

- 现状：观测台偏运维视角（SLO 表、trace 面板，`apps/web` 5 个 tab）；
  Town 页为静态地图 + overlay。
- 缺：活的城市视图——Agent 实时移动、建筑生长、地价热力图、事件流 ticker。

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

剩余缺口（未变）：A 空间/建造、B 交通物流、C 服务短缺动力学、D 人口生命周期、
E 的治理命令面（税率/预算仍是参数而非参与者可调命令）、3.x 的 LLM 自主企业/外贸动作
（命令层已就绪，`actionRepair.ts` 动作集未打开）。

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

## 推进顺序建议（按 ROI，尊重确定性 event-sourcing + authority 三关：确定性/replay/幂等）

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

# 身体退出边界、既有服务和已赚劳动

状态：工资接续、退出前雇佣终止、睡眠/学习终止已通过工程验收；建设施工终止已通过工程验收。world候选批次按先结束参与、再捕获最终资产、最后删除身体的顺序执行。真实运行时journal事务、移动/在途保管、其余责任和自然人口调度仍未接通。

## 已证实的现有能力

在退出前已结算到边界的前提下，提供者或接受者死亡，原服务逻辑可在同一模拟时刻终止双方presence、释放存活参与者独占时间、保留已发生时长/身体效果/分成、退款给原出资人，并保留退出主体的现金/物品捕获。旧与actualTime两模式共4项集成用例已通过，不需要为这条路径增加规则或新命令。

测试先真实offer/accept/fund/start，推进1000ms结算，再以实际人口事件捕获退出，最后调用原服务settlement。断言progress与所有已付收入不变、participant-unavailable、无退出者身体、无剩余托管、存活者释放、总供给与完整回放一致。这不是自然死亡cadence已接通，也不能外推未结算时间已经自动补齐。

## 实现前工资路径的源码阻断

residentLabor.stopUnavailableResidentLabor已能根据原身体缺失生成停止决定，但随后residentLaborCommit仍进入projectionReducers/residentLabor，后者无条件要求agents[session.actorId]存在，缺失时报labor-person-missing。earnedCompensation拥有原企业债权/实际时间/税与付款证明，而读写身体和付款账户仍混用。因此不能仅把“停止本人劳动”检查改为允许未知人，也不能在企业没付钱时删掉原claim。

该段记录实现前源码定位；现已通过下述真实工资/欠薪/死亡组合实现并验证定时劳动分支，生产和服务工资不能据此推定已完成。

## 完整边界与执行顺序

1. 自然人口编排必须先按死亡的实际模拟边界结算已有劳动/服务进度，再结束未来身体参与并处理该批次的工资/退款，随后捕获最终身体与资金，最后删除身体。已结算时间与真实现金支付时刻分开记录；不能把死亡之后支付的钱回写到现金捕获之前。
2. enterprise继续拥有原earnedPayroll claim、未付余额和企业现金；society拥有原工资与累计预扣条款；world持有本人劳动/生产/服务的来源证明。结束身体不改变原债权归属，不解除企业偿付义务。
3. 新版本化退出结算只允许原已赚金额及税款，读取真实保管主体，复用estate毛额回执。普通AgentClaimWage仍要求活着的本人；系统结算不是替死者发起新劳动，也不赋予家属提款权。
4. 原工资证明保留enterprise→原员工/国库账；若estate消费者需明确clearing对手方，按原证明拆成严格平衡毛额腿，净clearing为零。不得修改enterprise债权/付款真相以迁就会计adapter。
5. 现金不足保留未付claim；未来真实补资后仍须能支付原主体。无保全来源必须拒绝，不能把未知人当作无债权。生活劳动、生产工资与服务工资共用原earnedCompensation核验，防止三条公式分叉。
6. 新增持久字段/策略须可回放，旧事件不重解释。先做实际事件/多周期/原子性与守恒验证，再接整体人口启用和居民继任入口；原25项和全模式范围保留。

## 验收而非扩展剧情

工资完全付清与部分欠薪、死亡当边界、退出前后的原税累计、本人权失效、保管收入与企业/国库守恒、补资后偿付、重复与篡改拒绝、多周期等价、旧事件兼容。不会增加自动继承人、强制劳动、满意度或默认企业接管。


## 前轮服务验证记录

4项新组合用例、原服务23项针对测试通过；lint、全仓typecheck通过，全仓3323通过/1原跳过。仅测试与文档变更，无公共export/生产代码变更，未重建或重启居民运行；沿用上轮已验收编译产物。原世界仍802。工资段仅源码定位，未计为实现完成。

## 定时企业劳动的原工资接续

可选 `ResidentLaborCommitted.estatePayment` 使用 `resident-earned-wage-estate-v1`。只有已保全的退出主体、原劳动记录、原冻结工资条款及原企业债权可进入。劳动仍活跃时仅允许 system 冻结此前已结算的 elapsedMs/settledAt；已结束的债权可由同一内部端口偿付。付款发生时间是当前世界边界，劳动赚取时间独立保留。普通活居民事件不需要新字段；未知人、冒用本人、缺失退出证明、追加未来工作均拒绝。

原 `applyEarnedCompensationProof` 先验证企业记录/付款、累计税额和原 enterprise→agent/treasury 分录。新 application adapter 才生成确定性 gross/net/tax 毛额腿与现金保管回执，clearing 净额为零，无持续余额、无新金融产品。enterprise 仍由企业领域事件扣款，treasury 仍收原税额，estate 仅收税后工资，不恢复身体或活动预留。零支付/全额税时保留退出来源证明，不伪造现金保管入账。

新消费者来源只由上述版本化事件进入；没有新 CLI/常态上下文/自动继承权限，也不修改原 manifest 或开启人口策略。将来生产/服务工资应复用该现金 adapter，但必须各自验证真实工作来源，不能直接放宽普通个人账户授权。

新增7组真实世界组合：无支付能力、部分已付、非付款周期退出、已结束债权、零劳动、零税、全额税。真实死亡捕获后冻结劳动；企业通过原 AgentFundEnterprise 补资，再以内部结算端口付原欠薪。断言已赚数额、企业欠薪、累计税、保管现金、无身体/预留、守恒、输入不变及重放；伪造来源/原账、冒用身份、缺证明与重复提交拒绝。28项定向测试已通过。完整自然人口时序与自动追偿调度未在本切片内宣称交付。


后续源代码核对：`serviceWages.applyServiceWagePaid` 仍要求 service-creditor-or-enterprise-missing；`productiveWages.applyProductiveWagePaid` 仍要求 productive-creditor-or-enterprise-missing。下一步复用本次现金adapter，分别保留两者原实际工作/结束证明与本人参与边界；不得将这个定时工资证明套在未核验的服务或生产记录上。该核对是源码证据，尚不是两路径死亡组合验收。


本切片最终门禁：28定向测试通过；lint、全仓typecheck、全仓3330测试通过/1原跳过；world及依赖构建全部通过。没有新真实OpenCode证据，不更改原世界802。证据：`evidence/SOCIETY_EARNED_WAGE_ESTATE_2026-10-07.json`。


## 生产与服务的已结束债权

`settleDepartedProductiveWageEvent` / `settleDepartedServiceWageEvent` 是 world 内部结算端口，事件执行者明确为 system。读取各自已有 claim context 与 enterprise 原债权；必须已结束、赚取截止不晚于真实退出、存在原现金保全且身体不存在。普通本人领取函数不接受退出者。可选 estatePayment 保持旧事件解释，仍经原earnedCompensation与共用earnedWageEstate证明，现金、税和债权同一world event提交。

不重新执行配方、服务效果或劳动决定。没有新worker自动收款调度、居民CLI或manifest开关；自然人口未启用。活跃生产或服务会被 ended-preserved-wage-required 拒绝，必须先完成真实边界结算和终止，不能以现金接续替代身体释放。

两套真实运行fixture分别先创建/授权/开始工作、推进实际时间、结束劳动和真实补资，然后把原世界快照接入隔离的真实退出事件组合。各自验证原债权支付、累计税与现金差额守恒、不重建身体、不改材料或服务进度、旧本人入口拒绝、篡改/重放/重复及陈旧版本拒绝。另两例故意保留活跃工作，验证不会偷偷自动结束或付款。原runtime journal仍保持并重新打开回放。


### 下一集成的源码证据

`handlers/timeAdvance.ts` 当前在劳动progress/企业lifecycle和stopUnavailable*之后调用population turnover。后者仍在 `emitDepartureLiquidation` 释放企业成员并按旧人口政策清算银行/销毁余额，然后发AgentDied，未调用prepareResidentExitCapture。这证明现金consumer接通不等于自然人口已安全启用。下一项必须把同一模拟边界的已发生劳动结算、未来参与终止和真实资产/责任捕获组成版本化应用流程，保留旧人口历史；不能只把旧AgentDied改一个字段或为每个工资另开一种死亡规则。此处为源码证据，尚未声称新自然死亡组合验收。


生产/服务已结束工资最终验收：新增4组合，29定向通过，lint/全仓typecheck通过，全仓3334通过/1原跳过，worker及依赖build全部通过。证据 `evidence/SOCIETY_PRODUCTIVE_SERVICE_WAGE_ESTATE_2026-10-07.json`。两种活跃劳动仍明确拒绝，下一工作是原子退出编排，不是继续扩展付款种类。原世界802、无新模型实验。


## 活跃雇佣退出组合诊断（不是功能验收）

同一真实生产/服务fixture如今在先捕获退出、保留原活跃劳动后，进一步调用真实结算端口，已复现：

- 企业服务：同一模拟时刻调用 advanceResidentServiceEngagements，拥有领域已经生成 participant-unavailable 终止，但组合工资reducer抛出 `service-worker-required`，不能提交。这与没有企业工资的普通服务参与者测试不同。
- 企业生产：捕获后下一毫秒调用 settleResidentMaterialEvent，返回终止事件候选，组合回放抛出 `productive-worker-missing`。输入世界、原债权、材料和服务状态保持不变。
- 生产另有同刻细节：materials.settleMaterialProduction 对 tick 且 at===session.settledAt 直接返回无事件；不能假设同刻调用便会释放失效参与者。下一毫秒能形成候选，仍不代表可以把工资赚取截止改到退出之后。

这两条是预期失败的诊断断言，不计为活跃退出交付。结论：不能先删身体，再指望普通settlement自行扫尾；现金收款连续性与真实参与终止必须在同一边界显式编排。也不能通过把missing-worker拒绝删除来完成：必须核验原工作来源、终止后不增加实际劳动/效果、真实款项进入当前保管账户、支付时间与赚取时间分离。

推荐实现顺序：用真实人口决定作为来源，先完成截止该边界的工作事实，再以明确系统原因终止参与（不得伪造本人主动leave），随后保全当前原资产/责任并删除身体。旧人口清算事件保持原解释；意外已捕获且仍有活跃工作的旧实验状态，需要明确恢复路径，不能静默补时或掩盖失败。自然人口启用必须等待全责任覆盖，不能以工资分支完成代替货物、在途位置和其他身体活动。


诊断门禁收口：14针对测试通过，lint/全仓typecheck通过，3334全仓通过/1原跳过；仅测试与文档变更，不重复构建。`evidence/SOCIETY_ACTIVE_EMPLOYMENT_EXIT_GAP_2026-10-07.json` 的 acceptance=false 保留真实未完成状态，不能引用测试通过宣称这两条活跃退出已完成。


## 明确系统生产中断（全仓3337测试与依赖构建通过）

退出编排首先需要诚实的动作来源。原 stopUnavailableProductiveWork 在雇佣/身体条件失效时调用居民 leave-production，回执却写本人和 left。这并非真实本人决定，不能直接复用到人口退出。

materials 新内部 interruptMaterialProduction 只在 job.at===session.settledAt===当前边界 时生成两个事实：移除会话并记录 worker-unavailable；追加 production-interrupted-v1 的 system 回执。不增加努力、转换或转移，不改变原held材料、库存、配方、已完成数量和进度。未结算时间拒绝，必须由原身体/生产端口先结算。

applyMaterialCommit 对此新操作验证精确事件范围、旧会话来源、system署名、原物理状态不变；不是在reducer重跑领域决定。旧leave/历史事件保持原解释。world 的可选 interruption 证明使用 resident-material-employment-interruption-v1，核验实际生产/工人/雇主、已启用生产雇佣、身体仍存在，以及雇佣授权失效或健康不可用。缺证明或工作仍获准一律拒绝。命令编码器不提供此系统操作。

现有雇佣生命周期改用这个端口，原工资领域事件和结算继续原子提交；结束生产后欠薪仍在，材料保留待后续继续/取消。新增2个领域边界测试（0/500ms）与1个真实企业组合，验证拒绝/保留实物/不追加身体效果/明确执行者/释放真实时间/篡改和重放。20项定向测试已通过。

这提供了退出前可用的系统终止原语，不表示先删身体再扫尾已修好，也不表示自然人口可启用。下一协调层需先释放真实成员关系，再终止本人生产/服务/定时劳动并捕获资产；其他身体活动与全部责任仍须接入。新操作显式版本化，无新居民命令/常态上下文/manifest重写，已有金额与配方语义不变。


系统生产中断最终门禁：20针对、3337全仓通过/1原跳过，lint/排序typecheck通过，worker及依赖build通过。见 `evidence/SOCIETY_SYSTEM_MATERIAL_INTERRUPTION_2026-10-07.json`。原活跃退出诊断仍保持失败含义：本次只提供删除身体前的明确系统终止，不宣称自然人口或先删身体后的恢复已经完成。


## 雇佣退出候选批次（工程验收通过）

`prepareResidentEmploymentDeparture` 是world应用编排端口，不是居民命令、死亡判定器或人口启用开关。输入必须是当前模拟边界的未捕获人口事实与开启保全的世界；应用仍负责该死亡/迁出来源的产生。输出仅为完整候选事件批次；调用者必须整批写入一个journal事务，不能分条提交。当前尚未接入worker自然人口或canonical调度，不声称已经验证真实人口journal提交。

顺序：验证原保全来源和已结算劳动边界；按稳定企业ID排序释放目标居民成员关系；只针对目标居民调用实际生产、企业服务与定时劳动的系统终止；确认没有遗留实际参与；使用工资和退款结算后的当前余额生成最终capture；最后应用并返回人口事件。中途任何拒绝都只返回reason，没有事件数组、不修改输入。债权、付款、体力、材料、服务的事实仍由原所属领域校验。

stopUnavailable*新增可选onlyActorId供编排使用；旧调用不带此字段，保持原行为。不能为了目标居民的退出顺带停止另一位健康或失业居民的工作。服务结束对原合同对手方的释放/退款属于原服务语义，不是对其他居民独立劳动的扫停。

已结算的睡眠/学习/建设按下述新活动路径终止；残留移动、未处理的材料会话、未结算建设会话、服务在场或其他未来独占时间仍拒绝。这项检查不是其他领域已经实现退出。现阶段仍须逐一接入对应真实终止/保全端口，不得通过删除检查来打开自然人口。存在活跃劳动但未结算到当前边界同样拒绝，不能少算最后一段工时。

新增两项定时劳动/拒绝测试，并扩展此前两项实际生产/服务fixture：正确编排可以结束原claim、保留已赚工时、释放真实时间、移除成员并保全最后现金；旧先删身体再扫尾的诊断仍维持拒绝，记录为未支持的恢复路径。验证事件连续序号、最后才删除身体、目标外工人状态不变、相关现金守恒、材料/服务进度不增加、完整事件重放与拒绝时输入不变。32项定向测试通过。


雇佣退出候选编排最终验收：32针对、3339全仓通过/1原跳过，lint/排序typecheck通过，worker及依赖build通过。2项新增测试及2项原实际工作组合扩展，证据 `evidence/SOCIETY_EMPLOYMENT_DEPARTURE_BATCH_2026-10-07.json`。当前覆盖定时/生产/企业服务的退出前结束与最终capture，未覆盖自然人口调度、实际journal事务接入、其他身体活动退出和所有责任清算。


## 睡眠与实际学习退出（工程验收通过）

原候选编排在雇佣终止后调用 residentDepartureActivity：只允许当前边界、身体仍存在、保全已启用和本人尚未退出的实际人口来源。可选 departure 来源使用 resident-departure-activity-v1，明确system执行者、居民、人口事件ID/类型/原策略/边界。来源是外层人口决定的审计引用，不由这层重新判断死亡或迁出；最终人口事件必须与停止事件同批提交。

society.rest增加显式系统人口中断输入；普通本人中断保持原语义。停止只变状态/修订，既往elapsedMs和恢复不动。world原reservation核验与释放不变，新增来源不生成“本人决定停止”的记忆。旧rest事件无此字段仍原样解释。

society.elapsedStudy增加 population-departure 终止原因，仍只接受system且要求当前进度已结算。world必须同时带对应来源；缺证明、错人、错时间拒绝。分配/退款继续使用elapsedStudyEffects和原studyAccountingTransactions：未用个人学费回本人，未用国库学费回原国库，随后capture捕获最终个人余额。教育分数/实际已付费用/原资金来源不改，不新增学习效果或正式等级。

42项针对测试通过：睡眠0/30000ms、未结算时刻拒绝与其他人不变；自费/国库学费学习分别先实际学习15分钟再退出，验证退款、剩余托管为零、既往分数/分配不变、回放与输入不变。新增两个领域测试覆盖system权限、既往效果及退款。

建设已按下述新路径接入；未覆盖的移动/在途货物、独立服务/集会等仍拒绝；自然人口和运行时原子journal提交尚未启用。没有新居民工具/常态上下文，也不修改原manifest。


睡眠/学习退出最终门禁：42针对、3344全仓通过/1原跳过，lint/排序typecheck、worker及依赖build通过。增加5个测试实例（包括把原睡眠拒绝实例替换为0/30000ms正向及未结算拒绝）。证据 `evidence/SOCIETY_REST_STUDY_DEPARTURE_2026-10-07.json`。测试人口源为死亡fixture，迁出完整组合/真实journal接入/其他活动与全部责任域仍需后续验收。


## 建设施工退出（工程验收通过）

premises.interruptConstruction只在工程与当前会话已结算到同一边界时移除会话，记录worker-unavailable，返回原真实时间预留的释放事实。工程仍open；plan、progressMs、原controller、土地占用、已绑定材料/工程义务不变。此操作不是cancel、finish或拆除，不自动生成建筑、退料、丢失劳动或选择替代工人。

world interruptResidentConstructionForDeparture通过独立residentDepartureActivitySource契约核验system及实际人口来源，再用现有premises包装、材料与身体回放路径提交。带departure的事件必须只含一个对应工程变更，无材料事件、努力或新预留；回放逐字段验证物理事实仅去掉会话/增加修订/记停止，并验证精确释放。不同worker、篡改进度或漏释放拒绝。

来源类型/验证单独归residentDepartureActivitySource，具体活动适配器不反向依赖residentDepartureActivity编排器；新增活动保持单向依赖。该调整不修改来源字段或既有持久语义。

新增1个领域与2个world组合测试（0/120000ms）。从真实供料、授权、开工和实际进度开始，退出前先中断施工，再捕获最后个人现金；原材料状态、土地/建筑、工程控制、计划与投入不变，其他居民不受影响。错误时间整批拒绝，篡改进度/主体/释放被回放拒绝。13项定向通过；来源契约提取后lint、排序typecheck、全仓3347通过/1原跳过，worker及依赖build通过。证据见 `evidence/SOCIETY_CONSTRUCTION_DEPARTURE_2026-10-07.json`。

仅补建设活动，不宣称移动/货物/独立服务/全部责任与自然人口或真实journal接入已完成。无新居民工具或默认上下文。

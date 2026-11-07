/** Platform reference, never a proposed resident institution or mandatory scenario. */
export function societySkillPages(): Readonly<Record<string, string>> {
  return {
    'society/finances.md': `# 公共财政事实

用 town city observe --view fiscal 主动查询当前国库余额与已记录的税款、补贴分类汇总。余额是当前存量，不表示过去有没有收支。

这是原事件的有限查询，非完整国库总账。只覆盖返回的 supportedEventTypes；其他复合结算中的税款、工资、公共预算、托管等不在范围内，不能用这些分类与余额作完整对账。

groups中的每项amount/count只属于本页扫描范围，来源treasury与mint分开。旧未标来源的补贴仍按原规则视为mint。不给他人姓名、私人余额或合同正文，也不替你解释因果。

每页最多扫描128个提交、2048个世界事件。nextCursor非空时，用 town city observe --view fiscal --cursor '<原值>' 查更早范围；即使空页也可能有下一页。不要为此视图使用section/offset/limit。historyThroughRevision固定这组历史分页的上界；currentTreasury.observedAtRevision标明本次余额时点，两者可能不同。

政策通过 town governance status 查询，具体税制等通过 town city observe --view rules --section index 找到。你可以自己比较原始事实、写下不同解释或提出政策；查询不改变任何政策。

[观察参数](../commands/city.md) · [返回](index.md)
`,
    'society/obligations.md': `# 居民自己的有限周期付款

目的、合作方、金额和是否采用由你决定。这是一份明确的金融承诺；把正文写成租金、会费或学费不会授予住房、成员资格、教学效果或贷款本金。

先 town obligations list/read 查看当前当事主体有权读取的约定。付款方 obligations prepare --command '<完整JSON>' 获取精确请求：type为offer，填写id、title、terms、payer和revenue（sector与id）、amount、firstDueAt、periodMs、periods、acceptBy。时间均为绝对模拟毫秒，周期至少60000毫秒；金额为正且最多六位小数，最多128期。两方必须控制不同的真实账户。prepare不创建承诺、不扣款。

个人或当前企业管理者用 principals operate --request '<完整精确请求>' 发出约定；收款主体独立从 obligations read 取 accept 请求并操作。共同账户使用 collectives 精确 resource 决定，公共账户使用 governance 的 manage-resource 精确决定，批准整份有限总额和期限。普通成员、执行人或旧管理人的私人钱包不代替主体账户。私人周期能力可由运行者显式 enable-periodic-access 接入，不需要政府、不增加公共权限。旧 enable-periodic-obligations 是同时扩张公共范围的兼容路径。principals list 中 periodicAccess 给出当前独立接入策略；国库仍须另有公共范围和精确决定。启用不给原来文件补造同意。

接受后每期只按约定到期一次，实际资金和收入容量足够才真实支付。不足会保留明确欠付，后续时间不自动重试旧欠款、不借钱、加罚息或铸币。付款主体可从具体欠付期的查询回执取 settle 请求，按当前权限另行清偿；收款主体可取 waive 请求放弃该笔未付债权。集体或公共仍须独立批准精确动作。

任一原当事主体可以 terminate 停止尚未到期的未来付款，不能删除旧欠付、撤回已支付或替别人开始/停止身体活动。当前正好到期须先结算本期。管理权交接保留约定和历史署名，新管理者按当前权限操作，旧作者没有永久访问后门。有未来承诺或欠付时不能通过关闭共同账户/企业抹账。

常态上下文仅有查询入口，原文和各期记录分页按需读取。此能力尚未完成全模式接入、自然人遗产或企业整体清算；自动程序不能凭一次代理授权创建这类承诺。支付不代表主观满意或客观服务完成。

[完整参数](../commands/obligations.md) · [主体权限](../commands/principals.md) · [共同账户](funds.md) · [公共程序](public-procedures.md)
`,
    'society/capital.md': `# 共同融资与资本权利

这些是可选能力，不规定你应当创业、出资或采用某种股份比例。

先 town capital list/rights 查当前权利、资本版本和管理版本。经理控制经营、持有人取得约定权益、员工自己决定劳动，三者不同。普通 business fund 不自动获得股份或借款债权。

管理者 capital initialize 只把真实旧权益登记为原始来源。capital propose 冻结完整权利表、出资、实际收款账户和原文条款；现有及新增权益人、付款人和私人收款人各自 accept。出资进入托管，此时不归企业或旧股东。公司收新资本另需当前管理者 authorize；全部条件齐备后参与账户控制者 execute，资金与权利同时生效。

共同账户不能由普通成员直接代签扣款；用 collectives 的精确 resource 决议，resourceId为企业ID，arguments是对应capital命令参数、不重复enterpriseId。原提议的执行人离开后不会继续拥有集体撤回权限。

capital read 可核对条款、独立同意、实际托管和版本。未完成协议可按权限 cancel，到期/竞争版本失效退款回原出资账户。资本协议不等于保本贷款；分红来自真实可分配利润，汇入当前个人或共同账户，不给经理私人账户。

capital close 必须是当前经理并匹配资本/管理版本；实际库存、未完成协议、工资和服务义务未处置会拒绝。现金清算把实际余款按当前权益分配，不按估值造钱。完整实物清算、债务和继承还未提供；拒绝不抹掉资产或责任。

仅持有资本不会打开完整企业现金。查询分页，更多协议按需展开；没有自动估值、推荐股比或平台投资评价。

[命令](../commands/capital.md) · [共同账户](funds.md) · [经营管理](resources.md)
`,
    'society/public-procedures.md': `# 公共程序与居民自己的选择

这是能力说明，不是政治任务。你可以提案、反对、弃权、交流、提出异议或不参与；制度通过不代表观点正确。

先用 town governance status 查看实际启用情况、初始授权来源、当前程序、政策修订和财政边界。初始多数程序来自场景，不是假称你已同意；私人群主或章程不能自造征税权。

## 精确提案

town governance propose 的 --action 接受一个单引号包裹的 JSON 对象。顶层是 kind、expectedRevision 和 terms；不填写 actor、authority、source 或 policyVersion。

- set-employment：仅当status中employment启用。用town governance employment分页读完整occupations以及terms；--revision可查旧版或下一周期版。terms包含完整occupations数组、quotaByResidentialTier、ranking、defaultOccupationCapacity、occupationCapacityOverrides。每个职业条款是occupationName、minimumResidentialTier、educationFloor、eligibilityShare、prerequisiteCommodity（可为null）。ranking可从knowledge、housing、submitted中选择不重复的排序顺序；稳定ID最终破同分。expectedRevision取latestRevision。修改从下一招聘周期生效；不重试旧申请、不改变工资、已有学历或私人雇佣。是否提案及具体值由你决定。
- set-tax：expectedRevision用currentPolicyRevision；terms为 neutralRate、incomeTaxBrackets、tradeTaxRate，可选dividendTaxRate。每个税档是 upToAmount 与 rate，最高档upToAmount可为null；税率0到1。你自己选择具体值。
- set-budget：expectedRevision用currentPolicyRevision；terms为 cadenceMs、minimumTreasuryReserve、allocations。每条allocation为 service 与 amountPerCadence；服务种类和资金边界见status。cadenceMs至少60000，这是结算工作量边界。
- set-subsidy：expectedRevision用currentPolicyRevision；terms为 minimumBalance 与 maxSubsidy，仍受公开财政边界约束。
- set-procedure：expectedRevision用procedureRevision；terms完整保留或修改status中的procedure。electorate不得超出grant.residents；minimumTurnout与minimumYes是人数；allowVoteChanges是布尔值；minimumVotingMs、maximumVotingMs、executionWindowMs以毫秒计；executors可以是字符串electorate或名册内的居民ID数组。修改必须经旧程序通过，未执行的旧程序权限随后失效。
- invalidate-decision：此项不用terms；顶层为kind、proposalId、expectedRevision、reason，指向尚未执行的已批准提案。已经发生的事实不能这样删除。
- fund-service：仅当status中procurement启用。顶层为kind、engagementId、expectedRevision、maximumCharge，不用terms。先用town engagements read查一份已由接受者独立接受、payer为treasury/public-treasury的合同；expectedRevision与maximumCharge必须精确一致。服务条款不能在批准后替换。

- fund-goods：仅当status中goodsProcurement启用。顶层为kind、orderId、expectedRevision、amount。订单必须指定treasury/public-treasury付款、绑定实际freight，并已由买方独立接受。用town trades read查准确修订与金额。

--expected-procedure-revision另行绑定当前程序。--closes-at是绝对模拟时刻，需考虑其他居民是否有机会阅读与表态，不是持续时长。原文理由放--text，不会被当作执行代码。

## 选择、结果与执行

town governance read --id 提案ID 可读原文、精确动作和冻结程序；votes与objections分页读取独立表态和异议。vote的--choice为yes/no/abstain，必须本人使用最新--expected-revision。人可以按允许的程序改票；不能替别人投票。

截止后close记录程序结果，并不执行政策。符合执行资格的人可execute精确获准动作；目标政策修订、期限、边界或资源条件变化可能使它失败。失败不消费决定。propose/vote/close/execute是可选操作能力，不要求你按示例完成某个政策目标。

object只保存署名异议，不自动裁决、扣款或暂停世界。若想撤销未用决定，需要另提invalidate-decision并获得批准。未支持的公共权力不会因为正文自称法律而生效。

## 可选的实际公共采购

status没有procurement时，预算仍是原有抽象公共服务账户。显式采购模式会停用自动预算分配，set-budget不能再写非空allocations。已有公共工资、福利、预置学校等另有规则，不因采购功能自动消失。

供应者可用engagements offer指定payer-sector treasury、payer-id public-treasury。此选择把合同条款、参与者和资金/时长账目公开；他人的身体数值仍不公开。接受者独立accept后，居民可按自己的理由提出fund-service。engagements fund不能自行扣国库。

公共批准和execute只把最高总价从国库放入服务托管，不代表任何人已经出勤。供应者和接受者仍各自start；实际共同时间与投入才产生费用和已建模效果。提前leave/cancel或到期会停止未来服务，未用款退回原国库。engagements read与ledger可查看履约和退款；没有官方满意度评分或自动共识。

实际物品可用trades offer选择treasury/public-treasury付款；这会公开订单、所关联货运及账目。买方accept只表示同意，不扣国库。精确fund-goods提案通过并execute才托管货款；承运人仍需本人装载、移动和交付。买方验收或双方和解沿既有订单程序，退款回原国库。资金来源不改变目的库存的私人或集体归属，这并非公共资产登记。

[完整命令](../commands/governance.md) · [私人章程](collectives.md) · [自主组织](index.md)
`,
    'society/index.md': `# 自主组织与规则

你可以自行决定是否合作、怎样组织，或不使用这些能力。这里不规定社团、商店或人生目标。

- 世界规则：town rules list；town rules read --id 规则ID。区分系统可信性、模拟世界假设、初始制度、居民约定和个人解释。目录不会改变世界。
- 操作边界：town rules capabilities 分页查阅；town rules capability --name records.put 展开单项。可区分真实效果、居民陈述、同意、权限与个人解释，并查看本人参与要求、可委托范围和参数。目录没有授予权限，仍需执行时检查。
- [共同记录](records.md)：自己的字段、多人维护、修订历史与权限交接。名册、作品目录或账目内容始终是居民陈述。
- [公共财政事实](finances.md)：主动查当前余额与有明确范围的历史税款/补贴，不把零余额当成没有收支。
- [资源管理与交接](resources.md)：当前控制、实际使用权限与历史署名分开，双方独立接受，集体按精确决定操作。
- [实物保管与生产](materials.md)：现场材料、真实工作、部分进度、实际产出与库存交接。
- [真实服务履约](engagements.md)：独立同意、实际人时、收费报酬与注册身体/学习效果。
- [事实订单](trades.md)：独立同意、真实货运或服务证据、托管、争议与双方和解。
- [真实货运](freight.md)：独立接收、有限载荷、实际移动、保管与实际退回。
- [土地与真实建设](premises.md)：有限场地、独立供料、本人施工、改造维修与拆除回收。
- [空间使用许可](permits.md)：独立接受的用途、实名使用人和时段；管理、使用与实际占有分开。
- [共同融资与资本权利](capital.md)：独立出资与同意、真实托管、当前收益权与经营权分开。
- [真实共同账户](funds.md)：本人自愿出资、集体精确决定支出，实际余额与普通共享账本分开。
- [有限周期付款](obligations.md)：双方独立同意、真实逐期付款、欠付保留与停止未来承诺。
- [集体章程与决定](collectives.md)：成员独立加入、自己选择表决程序、按旧制度修改章程；文本名称不会创造公权力。
- [公共程序与政策](public-procedures.md)：显式公共范围、精确提案、独立表态、按旧程序修改制度与真实政策执行。
- [自定数据视图](views.md)：自己定义筛选、数值计算、排序和聚合；结果保留作者和原始记录版本，不成为官方评价。
- [条件与署名依据](conditions.md)：在有权读取的真实事实、原文或自定计算上设置条件；通过条件不会增加权限。
- [变化响应与中断](reactions.md)：有限次响应已提交来源变化，重新校验当前条件和权限，查询持久队列与停止原因。
- [有限流程与委托](programs.md)：原文章程与可执行流程分开；明确步骤、精确版本授权、限次执行及取消。
- 协商仍用 proposals/commitments，交流仍用 messages/groups。签署章程不会授予花钱、代发消息或控制身体的权限。
- 执行事实见 town programs runs；授权见 town mandates list；真实余额、库存、位置仍看既有世界查询。

只在启用 agent-driven-society-v1 的开放居民实验可用。旧实验需要运行者显式 enable-society-kernel。没有任意宿主脚本、自动裁判、全社会信誉分或编造的物理效果。

[入口](../SKILL.md) · [执行规则](../execution.md)
`,
    'society/engagements.md': `# 真实服务约定

先engagements models查公开效果、耗材和可归还工具，facilities分页查实际护理/教学位。普通人工服务只结算人时，不产生满意度。基础照护不是药物/手术；指导学习受教师知识上限约束且不颁学历；供餐确实消耗食品。

经营者用engagements offer提出不可变原文条款：controller、providerId、recipientId、付款与收入账户、pricePerHour、providerShareBps(0至10000)、maxDurationMs、startAt/endAt和模型。每小时价格最多六位小数；零价合法。约定ID最长60字符。供料者先在同地点stocks存实物并materials reserve --consumer-domain services --consumer-id 约定ID，独立确认受益控制者；offer的reservationRefs每个为保留ID@版本，可重复flag，没有材料时省略该flag。

recipient本人accept，资源才绑定；payer独立fund，实际最高费用进入托管。出资不授权身体。双方各自start --until 模拟毫秒，只占本人的时间；两人都实际开始才计重叠时长。真实工位/身体/地点不足明确拒绝。只预约、写评语或在文件中宣称完成没有效果。

本人leave或参与者/控制者cancel结束未来服务；已发生人时按累计金额结算分成，剩余托管退原付款账户，未消费材料与工具退原库存。消耗食品不会重新生成。截止、身体资源不足、设施失效都有实际终止记录。共同账户必须为已承诺的应收/退款保留空间，进入清结仍可收已有退款；集体只能通过精确collectives资源决定offer/fund/cancel，不能替人accept/start/leave。

list/read看自己获授权的约定，ledger分页看事实；只能读取自己的身体变化，付款人和经营者不能借账目窥探别人身体。默认上下文仅标志与engagements入口。旧实验enable-service-engagements不补种设施；真实建成设施可供使用。名称、组织与评价由居民决定，不能改写登记的效果模型。

[完整参数](../commands/engagements.md) · [材料](../commands/materials.md) · [设施](../commands/premises.md)
`,
    'society/permits.md': `# 空间与设施的定期使用

permits rules 查询当前规则，permits list/read 分页查自己有权读取的约定和署名。permits access --building-id ID 只显示你在该建筑的权限；newUseUntil 是新增使用的授权边界，null 表示当前无已知时间限制。实际居住或取回物品可能仍允许进入，但不授予继续生产、投料或接待的权限。

当前建筑控制者 permits offer：buildingId/buildingRevision 绑定真实建筑，granteeKind/granteeId 指定受让主体，users 是实名使用人列表，scopes 从 entry、operate、store、reside 中选择，mode 为 shared 或 exclusive。填写 title/terms 原文和 startAt/endAt/acceptBy 模拟时间。entry 不包括经营、存入或迁入，其他 scope 同时允许进入。shared 不保证设备空闲，exclusive 只排除该用途与时段内冲突的新使用；entry 不能排他。

受让方 permits accept --id ID --expected-revision N 独立接受；此前报价没有使用效力。如果报价已绑定交易订单，改用 trades accept 同时接受权限并托管价格，不能绕过付款单独接受许可。双方可以 permits withdraw 撤回未接受报价。已接受的内容不能单方改写或取消，受让方可以 permits release 放弃未来使用，正在进行的真实工作须先本人结束。集体使用精确 collectives resource 决定执行；成员身份不代替集体同意，也不替别人开始劳动。

实际生产和服务的 until 必须在连续许可期间内。到期阻止新的受保护操作，保留已完成劳动、库存和实际居住事实。仍需用 stocks withdraw 取回物品，不能把进入取回当成继续投料的权限。控制权交接保留既有许可；有许可义务时不能关闭、拆除或改造其用途/设施。维护与物理损坏仍按真实规则发生。

当前许可本身不扣款。有偿许可须另外接通原子交易结算；普通文件写上租金不会自动扣款。旧实验由运行者 enable-premises-rights 显式启用空聚合，不补造产权。

有偿许可的 permits read 返回 provision：availableMs 为已提供的有效且物理可用的权限时间，unavailableMs 为期间建筑不可用的时间。无需到场才开始计费，但原文、满意与实际参加始终分开。房屋损坏不抹去此前提供的时间；维修后只累计以后的可用时间。提前释放或到期时，未提供部分退回，已提供部分仍由买方确认或双方处理争议。

[参数](../commands/permits.md) · [建筑](premises.md) · [共同决定](collectives.md)
`,
    'society/trades.md': `# 真实履约与交易

你自行决定价格、合作和原文质量标准。trades rules查询当前支持范围；trades list/read/ledger查看有权访问的订单、来源和原始收付回执。平台不会替你生成满意评价。

卖方先安排尚未开始的真实来源，再trades offer：sourceKind为freight、service或已启用v2中的permit，sourceId及sourceRevision绑定真实过程；填写payerSector/payerId、revenueSector/revenueId、amount、acceptBy、title、terms。两账户分别归买方和卖方控制。价格最多六位小数，一个来源只支持一份订单，不重复售卖同一事实。

货物先完成材料和货运约定，买方取目的库存的控制者。商品价格与承运费是两项独立条款。服务引用engagements，必须pricePerHour=0，由订单计价；买方取服务付款账户的控制者，可以为另一位居民购买服务。服务受益人仍须本人接受和参与。订单收入不自动变成劳动者工资。

买方trades accept按精确expectedRevision接受并托管金额，此前对应freight load和engagements start会拒绝。未接受前任一方trades withdraw取消报价；到期会记录失效。开始履约后，不能仅取消订单就拿回款项并让在途货物消失；先在所属货运/服务过程按权限中断或退回。

有偿许可先由建筑控制方 permits offer，再 trades offer --source-kind permit 绑定原始许可。trades accept 把付款、许可独立同意和供给记录一起提交；任一步失败都不生效。租用人仍可按原许可的规则 release，真实占有与已存物品不会因退款消失。

真实交付或服务结束会产生订单履约记录，也可trades observe读取证据。服务按实际重叠时长计算可结算金额，退回未履行部分。实际货物退回/取消才返还商品款，运输退回费另算。收到事实不表示满意：买方trades confirm释放余款；有争议用trades dispute --content 原文。

双方可trades propose-settlement --refund 金额 --content 条款，对方trades respond-settlement --accept true/false。所有操作绑定当前expectedRevision；提案后的新操作会使旧和解版本失效。卖方trades waive放弃尚未收到的款项。退款不自动回收已到货的物品，也不抹去已经发生的服务效果。

集体当事方使用collectives的精确resource决定执行trades操作；成员个人不能擅自扣共同账户。旧实验由运行者enable-evidence-trade显式启用，不重写旧orders或补造资产。旧实验的有偿许可需显式enable-paid-permits升级；不会给历史免费许可补造收费。产权交割和长期义务继续按所属能力支持范围查询。

[参数](../commands/trades.md) · [货运](freight.md) · [服务](engagements.md) · [共同决定](collectives.md)
`,
    'society/freight.md': `# 真实货运与保管

freight rules查载荷模型。每份登记物品数量占一个载荷单位，这不是公斤。普通随身库存与手提货物共同受限；车辆同时计算乘员随身物品与车载货物。vehicles read查真实车辆载荷及来源，授权驾驶不代表受托货物的保管权限。

发货者先把实物存在来源stocks，再materials reserve --consumer-domain logistics --consumer-id 未来货运ID --beneficiary-kind resident或collective --beneficiary-id 发货控制者。freight offer写原文条款、两端库存和地点、reservationId及revision、确切items、指定carrierId、可选vehicleId、独立付款账户、deliveryFee、returnFee、deadline。ID最长60字符；费用最多六位小数；托管额为两个费用的最大值。

接收库存控制者本人accept预留接收空间；付款控制者独立fund；指定承运人本人到来源、空闲且有足够载荷时load。被写入约定不等于同意劳动。手提使用travel go；车载使用vehicles drive --id 车辆 --destination-id 地点 --expected-revision 版本。所有移动都需要真实路径、时间、进入权限及容量。

到达后指定承运人deliver，物品进入目的库存，交付费支付并退余款。车载货物留在车上，人单独走到目的地不能交货。货物不会进入承运人的可消费库存。

未取货cancel释放材料和款项；已取货cancel或到期进入return-required，货物和款项保留。必须实际回原处并return才能按退回费结清。不能用文字“送达”、超时或关库存把责任抹掉。集体可精确决定offer/accept/fund/cancel，不能代替个人load/drive/deliver/return。

保管接续先查freight rules的handoff.enabled与支持范围。显式启用后，用freight handoff --id 货运ID --handoff-id 提议ID --action propose --next-carrier-id 本人接手者 --expires-at 截止时间，可选--vehicle-id；前保管人或发货控制者提议，原费用收款人不变。freight handoffs --id 货运ID分页查看精确提议版本。各方分别用--action consent --role source/recipient/payer/previous-carrier --expected-revision 提议版本同意，接手者本人用--action accept执行；--action withdraw撤回。这个版本是提议版本，不是货运版本。

停放货物须实际同址/闲置/载荷与驾驶许可均通过；退出者来源由系统核验，不是填写名字即可跳过同意。在途恢复尚未接通。集体须另行显式enable-collective-freight-custody，然后以collectives的resource决定绑定freight.handoff、货运ID和完整action/handoffId/role/expectedRevision等参数；只允许提议、同意或撤回，不能代人accept。消费后的同意是一份精确许可，接手时检查其原提议及当前章程版本，不重复消费。章程改版或整份提议撤回可使许可失效；原代表不获得永久撤回权，仍须当前精确集体决定。运行者enable-freight-custody显式升级旧journal，不新增资产、不重写manifest。提名使接手者可主动查看待处理约定，撤回/到期后失去这条邀请读取权；已查询原文可能仍在模型历史。

freight list/read/ledger只向获授权方提供约定与原始事实。默认上下文仅有入口，不会广播货单、账户或承运人其他行踪。旧实验enable-logistics等待未完旅程结束，不增加车辆或历史载荷；超载物品保留，可现场存入库存后继续出行。

[货运参数](../commands/freight.md) · [车辆](../commands/vehicles.md) · [材料](../commands/materials.md)
`,
    'society/premises.md': `# 土地、建设与真实设施

你自行选择是否建设、用途、合作人、名称和组织方式。sites list/read查询真实有限场地与初始土地许可；物理面积和“谁能使用”是不同规则。初始公共许可不是居民投票共识。普通文件或CLI不能创造土地。

construction plan --kind build --primary-use residence --floor-area 8 --capacity 2 --workstations 0 --care-stations 0 --teaching-stations 0 --storage-units 0 查询材料和实际工时。改造/维护/拆除用kind modify/maintain/demolish并给buildingId；没有完成工程就没有建筑、容量或资产。名字不创造疗效、学历、员工或收入。

供料方先在sites read的parentLocationId真实存料，然后materials reserve --id 保留ID --stock-id 库存ID --expected-stock-revision 当前库存版本 --beneficiary-kind resident或collective --beneficiary-id 发起方 --consumer-domain premises --consumer-id 未来工程ID --items '{"Wood":8}' --terms '原话' --expires-at 模拟毫秒。保留从库存实际移出，只供这一受益方和工程。未接收的offer可withdraw或到期退回；接收后不能单方面撤料。

显式启用construction-trade-v1后，可对尚未开工的实际工程约定有偿施工。principals read --kind construction-project --id 工程ID查精确版本，principals operate --request JSON使用construction-trades.offer；arguments为{type:"offer",terms:{id,projectId,sourceRevision,seller,buyer,payer,revenue,amount,acceptBy,title,terms}}，买方必须是实际工程受益主体。主体用{kind,id}，账户用{sector,id}，sector为agent/enterprise/collective/treasury。国库id为public-treasury，共同账户id为实际funds账户。请求外层resourceKind=construction-project、resourceId=工程ID、resourceRevision=来源版本、controlVersion=1。

订单用principals list分页找到，再principals read --kind construction-order --id 订单ID查原文和requestBase。操作accept/observe/withdraw的arguments为{type,id,expectedRevision,side}，side为buyer/seller，只有buyer可accept；外层operation.capability为construction-trades.动作名，其余复制当前requestBase。propose-settlement额外给proposalId/paySeller/text；另一方accept-settlement额外给proposalId。个人当前管理权不代表集体同意：集体用collectives精确resource决定，公共用governance精确manage-resource决定。不能通过条款强迫本人劳动。

接受时真实全额托管；完成实际施工后有权的一方observe结算。未付款报价到期关闭，已付款不会因时间流逝失去资金或责任；中止仍需另一方独立接受分款。平台不判断主观满意。报价不冻结他人项目；正文只按权限主动查询，不广播。旧实验需运行者显式enable-construction-trade，新manifest需显式启用，建设权本身不含采购权。

工程控制方construction create输入蓝图参数、id/buildingId/siteId/expectedSiteRevision、controllerKind/controllerId、title/description、workers及reservationRefs。reservationRefs格式为保留ID@版本，可重复参数组合多方材料；合计必须恰好匹配蓝图。同意供料不等于同意为他人工作。

工人本人出行到外部作业地点，再construction start --id 工程ID --expected-revision 当前工程版本 --until 模拟毫秒。单工位一次一人，大家可自愿接续。leave只停止本人，已有进度/体力消耗保留。完工自动结算保留材料、建筑和真实双向道路；cancel只退未消费材料。construction read检查progressMs、workMs、lastStop、settlementBlock；完工结算阻塞后先处理原因，再finish重试，不会无限续工。

premises read查物理容量、状态；控制者及交接目标还可查权限、材料和未清义务。configure分别设置entry(public/listed)、visitors/operators/residents；公共进入不授予经营或居住权。居民本人决定是否housing choose；现有有效租约和物品不会因新ACL消失。建造设施不会自动提供服务，仍需本人服务供给。

offer/accept/cancel-offer独立交接，保留历史创建者和现有义务。正在施工的建筑不能转交。collectives的精确resource决定可创建/取消/结算工程、供料和管理建筑，不能代人start/leave。领取材料的决定必须绑定recipientId，执行者必须是这个人本人。

启用premises-facility-use-v1后，同一建筑的所有库存合计使用其实际storageUnits，未完加工投入、未来产物及可能退回的供料仍占预留；stocks read/premises read的facilityUse显示容量和粗粒度总用量，不显示别人的库存详情。每个正在加工的会话占一个实际工作位，进入和集体成员身份不代表经营授权。本人leave或完成释放工位，运营授权丧失会停止未来工作但不没收本人库存；库存清算和取回仍各按原权限。旧建筑实验由运行者enable-facility-use显式预检升级，超额不删除货物。

当前物理模型每完整模拟日损耗1/1000条件，closed建筑仍自然老化；维护要真实新材料和工时。改用途须先处理义务并关闭，纯内部改造使用明确的材料/工时比例；原地扩建消耗余量，不能缩小已有容量。工作都在Site外部，允许维修尚不可进入的建筑。

close要求没有在场人员、居住/到达预留、租约、库存或服务义务。拆除先close，再提交demolish蓝图和本人劳动。实体材料按登记比例回收，残料留在场地，仍有控制者；本人到场premises collect-salvage --recipient-id 本人 --items JSON领取。最后一份残料清走才释放场地面积，损失有记录。

旧实验enable-premises不补造土地。运行者可用带sourceId的register-construction-site作明确迁移；这不是居民的土地创造能力。默认上下文只含启用标志和四个查询入口，更多内容分页主动读取。各域组合和真实自主运行验收分别记录。

[construction参数](../commands/construction.md) · [材料保留](../commands/materials.md) · [设施参数](../commands/premises.md) · [场地参数](../commands/sites.md)
`,
    'society/materials.md': `# 实物保管与实际生产

你自己选择是否、为谁、如何生产。库存、订单、产品名称和集体宗旨是不同对象。空stocks记录不创建土地、建筑或物品。

先 production recipes 按页查真实配方；新加工模型把既有输入/体力成本显式注册，至少一分钟工作，无随机奖励、无住房财富等级门槛。若sources list显示显式有限原料模式，原料也需现场实际劳动；旧business produce已禁用。未启用的历史模式仍保留旧命令语义，不能把两套配方混用。

启用有限原料模式后：sources list/read按页查看位置、数量、修订、实际工作消耗和同时工作容量。laborSlots显示当前总名额、占用和余量，production read也给出对应来源入口；这不是预订或未来空位承诺。material-source-labor-capacity-unavailable表示原料源满员，与室内加工工位不足不同，造房不会增加原料源名额。到源所在位置建立或选用有权操作的库存，再production gather，参数为id、stockId、expectedRevision、sourceId、sourceRevision、quantity、productName、description、workers。workers至少一人，CLI必须显式传--workers 居民ID，可重复该flag；指定只给工作许可，不代人开始。不能省略成空列表。这只预留尚未取得的资源；随后本人production start，实际劳动才把物品放入库存。取消时未取得的资源退回原源，不进私人库存；sources list未返回regrowth时有限初始源不会自动补货；未完成的预留24模拟小时后到期，退回未取得部分，已完成产物仍保留。

stocks create --id --title --location-id 在本人当前位置建立空保管记录。stocks deposit --id --expected-revision --items '{"Wood":2}' 本人现场存入真实物品；控制者用configure明确contributors/readers，权限不等于加入组织。stocks read按limit/offset分页读contents和未完订单；list仅列可发现记录，ledger读实际流转。没有读取权的贡献者只见办理元数据和本人回执。

若sources list/read返回regrowth，低于原始数量的源按其比例每模拟日以整数回长，不超过原始数量，回长前采空就要等待或另找来源。若production recipes返回learningByDoing，你本人在同一产物上已提交的实际工时会让之后新建的批次更快、更省体力；yourPace只显示你自己的经验和速度，多人批次按名单中最不熟练的人计。没有人被指派技能，熟练来自自己实际做过的事；别人的熟练度只能通过交流或交易了解。

production create --id 新订单 --stock-id 库存ID --expected-revision 库存版本 --recipe-id 配方ID --quantity 数量 --product-name '自选名称' --description '原话' --workers 本人ID 创建不可变材料/工作计划；可重复workers。输入移入订单托管，不立即产出。只注册有真实输入的加工，不能写名称凭空造矿石或药效。

允许的工人本人 production start --id 订单ID --expected-revision 订单版本 --until 模拟毫秒。须真实在场、空闲、具备体力；一次一位，可由不同人接续。production leave本人提前离开，保留已发生工时；每整单位完成才产生注册产物。控制者cancel停止未来工作并退回未消耗材料，已完成产出/体力事实保留。工作回执不自动创造工资、品质、学历或满意度。

stocks withdraw --id --expected-revision --recipient-id 本人ID --items '{"Book":1}' 仅由被精确授权的领取人本人现场执行。集体决定必须明确recipientId，其他执行者不能领走。stocks offer --id --expected-revision --expected-control-version --target-kind resident或collective --target-id --expires-at --terms独立交接；目标accept，原控制者cancel-offer。当前目标可审阅真实库存和未完订单。交接保留在途义务与原始作者。

集体可用精确resource action执行stocks configure/withdraw/offer/accept/cancel-offer/settle/close与production create/gather/cancel；不能投票代人start/leave/deposit。格式为{"kind":"resource","capability":"stocks.withdraw","resourceId":"库存ID","arguments":{"expectedRevision":当前版本,"recipientId":"实际领取人","items":{"Book":1}}}。production.create的resourceId是新订单ID，arguments另含stockId及所有其他CLI参数。资源失败不消费已通过的决定。

显式启用productiveEmployment时，集体可在production.create/gather的arguments加入enterpriseId与expectedEnterpriseControlVersion，授权真实公司工资；企业和库存必须由同一集体实际控制，两套版本都会验证。个人创建生产单可用--enterprise-id。工作者必须已独立入职，本人start后才产生真实工时和工资；不指定企业则不制造公司薪资。

stocks settle停止新存入/订单，现有订单可完成或取消。关闭前实物归零且义务清结，不能借关闭丢弃别人的材料。旧实验由运行者显式enable-materials，不补种物品。默认上下文仅标志和查询入口；已读原文和真实回执会按个人阅读记录保留，更多状态自行查询。

[stocks参数](../commands/stocks.md) · [production参数](../commands/production.md) · [共同账户](funds.md) · [自主组织](index.md)
`,
    'society/resources.md': `# 资源控制与独立交接

当前支持space（信息空间）、register（共享表）、view（居民数据视图）、group（通信群）、enterprise（企业经营控制）；显式启用service-control后还支持service（服务目录管理）。真实房屋、库存分别走premises和stocks，共同账户走funds。车辆及尚未支持的义务依各自领域继续接入，不以文本命名冒充已有能力。

resources list 列本人实际管理、所属集体管理或本人/集体被提议接管的资源；read --kind 类型 --id ID展开controller、资源revision、controlVersion与交接原话。只提供管理元数据，不泄漏私人正文、表记录或视图算法。旧ownerId保留历史兼容；一旦有control，当前controller才是管理主体，原创建者不再有隐含特权。

个人控制者用 offer --kind --id --expected-revision 当前资源版本 --expected-control-version 当前控制版本 --target '{"kind":"resident","id":"接收者"}' --expires-at 模拟毫秒 --terms '交接原话' 提出。target的kind也可collective，ID必须是实际可操作的集体。提议不立即转交；接收者本人用accept加相同kind/id/两个当前版本独立接受。cancel撤回当前offer。期限最多30模拟日、原话最多2000字符。

集体控制/接收方通过collectives propose/vote/decide/execute。resource action为 {"kind":"resource","capability":"resources.accept","resourceId":"资源ID","arguments":{"kind":"register","expectedRevision":2,"expectedControlVersion":2}}，其中kind和版本须按实际情况填写。offer/cancel/manage也使用同名resources能力；offer参数还含target/expiresAt/terms，manage参数含operation。成员身份本身不能直接在resources命令中代表集体，也不能把一个集体的决定用于另一个集体。

个人controller可用resources manage；集体同样需精确决定。operation按资源类型为以下闭合JSON，不接收其他字段：

- group: {"type":"invite","invitationId":"唯一邀请ID","residentId":"居民ID"}、{"type":"respond","invitationId":"申请ID","accept":true}、{"type":"withdraw-invitation","invitationId":"邀请ID"}、{"type":"close"}。respond只处理居民亲自提出的申请，不能代为接受邀请；申请人可本人撤回。控制交接终止所有未决邀请/申请并记录实际原因，不自动入群或读取消息。
- space: {"type":"configure","visibility":"private","posting":"members","members":["可使用的人"]}；visibility可public/private，posting可owner/members/everyone。members只授予空间使用权限，不表示加入某个社会团体或已读内容。集体controller没有一个伪造的owner居民；posting owner时应先明确选择谁能实际发布。
- register: {"type":"configure","visibility":"private","readers":["可读的人"],"editors":["可写的人"]}。记录仍署实际createdBy/editedBy/authorityId，集体不能伪造他人评语。
- view: {"type":"disable"}，或 {"type":"revise","title":"原话","visibility":"private","readers":["可读的人"],"definition":视图定义}。修改算法仍要求执行者能读真实源表；结果是居民计算，不是官方评价。definedBy和definitionDecisionId记录新定义的实际执行者与程序出处，原来历史不改名。

控制交接不自动授予集体成员内容读取权。成员可以通过精确决定改变ACL；视图继续要求view和源表的双重权限。资料创建者/原作者若没有当前ACL，不能仅凭旧ownerId继续读取或管理。当前显式使用权限不会因为控制交接被悄悄删除；是否调整ACL由明确操作决定。

修改管理设置会取消挂起的交接；被撤销、过期、资源/控制版本不符的接受不会消费集体决定。给个人的交接不能由另一个成员代为接受。旧的registers nominate/accept仍用于从未进入新control状态的个人资源；进入后用resources offer/accept，避免旧提议绕过新的控制程序。原文作者、既有内容和历史版本在控制交接时保持原样。

service 当前支持个人之间的 offer/accept/cancel，可通过已独立授权的 resource.control 程序与付款原子组合。用 services 的原生命令排期、处理预约或停止接待；resources manage 不代替这些命令。交接保留原发布者、预约、队列和正在进行的实际供给。新管理员不能代替旧服务人员出勤或停止其出勤；旧人员仍能本人离开。企业绑定服务和集体服务管理尚未接入，会明确拒绝。旧实验须由运行者显式 enable-service-control，且要求实际服务供给 v3。

enterprise只交接经营权，两个revision均为控制版本，不代表企业全部财务版本。历史founderId不因交接改写；已启用资本模式时capitalPositions/equityVersion是当前权益来源，旧模式仍显示capitalShares。个人管理者沿business/market原命令经营；集体必须提案并独立表态：resourceId固定企业ID，arguments包含expectedControlVersion和原命令参数，不再重复enterpriseId。支持business.post-job/layoff/close/authorize-service/revoke-service及market.trade/export/import。集体成员、旧创立人、普通员工不能直接动用公司资金。员工自己join/start/leave，服务双方自己接受及参加。

企业管理者通过city observe --view enterprises按页看本公司经营事实；服务账用business services/service，个人工资用city observe --view labor。关闭须清结已有义务，余款和实物按已记录资本权益分配给权利人，不给执行关闭的管理员。business fund不会自动获得股份或债权；显式capital模式支持独立同意的出资和权益转让，以及无库存/未清义务的现金清算；完整实物清算和继承仍待接入；企业resource.control原子付费管理交接需显式program-actions-v3，见programs.md。群体失去程序法定人数会暂停新管理决定，不强迫任何人继续留在组织。

目前资源管理不会转移货币、身体状态、社交关系或未实现的物理资产。旧实验由运行者显式enable-resource-control，群组控制还需enable-group-control；manifest不自动改写。默认上下文只给入口，详细状态按需读。

[resources 参数](../commands/resources.md) · [集体决定](collectives.md) · [共同账户](funds.md) · [元能力](index.md)
`,
    'society/reactions.md': `# 有限响应与长期协作进度

可以自行选择是否让精确版本的程序响应来源变化。先定义programs条件/步骤，所有被代理人分别mandates grant；然后runner本人用 town reactions watch --id 自选ID --program-id 程序ID --program-revision 版本 --max-reactions 检查次数上限 --expires-at 模拟毫秒 登记。登记不立即执行，不构成任何新的授权。

每个已提交事务若改变条件来源的记录版本、视图输入、本人相关事实、共同账户或集体决定，产生一次待检查机会。clock能作为条件；只有clock的流程请用已有programs schedule。无关人的私人活动不会因为全局事件序号变了就触发本人余额条件。

每次处理重新检查**当前**事实、全部来源访问权和全部mandates；排队期间撤权同样生效。过去的触发版本不是将来付款的依据。条件不满足记为skipped，检查次数已用、mandate成功次数未用；权限/版本/实际步骤失败使watch停止，不无限重试。条件仍满足时新的依赖版本可再次执行；只想执行一次请设max-reactions 1并限制mandate次数。

town reactions list 列本人参与的watch；read --id 展开固定程序版本、次数、到期和状态；history --id --limit 1读取每次真实排队/完成回执及来源提交序号，关联programs runs。内部依赖指纹不对居民公开。runner用cancel --id --expected-revision 当前版本取消全部待处理机会，不撤销完成的事实，也不消耗剩余mandate。

默认每runner最多20个watch（含历史），全局最多1000；每个最多100次检查、30模拟日；全局最多128条pending，每轮处理最多32次，剩余的持久保存。互相触发不会递归占用调用栈。队列超载停止相应watch并明确写reaction-queue-overloaded，原业务仍提交。watch本身不预留资金、库存或身体时间。

重启先回放旧事实，运行循环再恢复待处理项；同一个结果不会重新扣款。原交易回执仍指原交易的revision，后续响应有自己的提交和回执。旧实验由运行者显式enable-program-reactions（须已有conditions）；居民不能升级平台规则。

[reactions 参数](../commands/reactions.md) · [条件来源](conditions.md) · [固定步骤与授权](programs.md) · [元能力](index.md)
`,
    'society/conditions.md': `# 自己定义条件与依据

在启用resident-program-conditions-v1时，programs publish/revise 的definition可为 {"steps":[...],"conditions":[...]}。仍需全部参与人分别授权精确版本；修改条件也使旧mandates失效。条件全部满足才执行原来的固定步骤，没有任意脚本、自动法律解释或客观信誉。

每个条件是 {"source":源对象,"op":"eq","value":标量}。op可eq/ne；数字还可lt/lte/gt/gte。字符串/boolean不转成数字。以下格式只说明能力，不建议用途或决定标准：

- 共享陈述源 {"kind":"record","registerId":"表","key":"条目","revision":"latest","field":"字段"}。revision可latest或正整数精确版本；精确版本与当前不一致时拒绝。
- 本人署名源在上述record格式改kind为statement，并增加signerId。实际editedBy和authorityId都必须是指定人。授权他人代写不冒称本人亲自作出判断。它证明该人写下这个版本，不证明观点正确。
- 居民计算源 {"kind":"view","viewId":"视图","viewRevision":1}，只比较其aggregate数值。结果保持resident-computation，不进入平台评分；空mean/min/max、除零等无有效数字时拒绝。
- 世界时间源 {"kind":"clock"}，值为当前模拟毫秒。
- 个人事实源 {"kind":"personal-fact","actorId":"本人ID","field":"balance"}。field还可locationId、availableAt、inventory（inventory须增加commodity原名）。availableAt取当前活动/旅行预留的较晚结束时间，不代表将来一定能开始某动作。
- 共同余额源 {"kind":"common-balance","accountId":"账户","controlVersion":1}。
- 程序决定源 {"kind":"decision","decisionId":"决定","charterVersion":1}，value只能passed/executed。来源章程版本和当前授权版本都要一致；条件不消费决定，也不会赋予其支出权。

程序作者、所有runners和所有principals都必须拥有全部来源当前读取权，不只是本次runner。个人完整事实目前只向本人开放，因此有其他参与者的程序不能代理读取私人余额；可由居民自己明确发布共享原文。共同余额只向当前成员开放；视图同时验证view和源表权限。撤权立即阻止之后的条件读取，不抹掉别人早已读到的历史。

programs check --id 流程ID --expected-revision 当前版本 供已获得全部mandates的runner检查授权与条件，不执行步骤，不写run，不消耗次数。run执行时会重新读取来源和校验实际步骤，不能把check结果当成未来保证。

run返回每条条件来源类别、ID/实际版本和matched，不广播原文或余额。条件false记录program-conditions-not-met，步骤不发生，委托次数不消耗；已通过条件但后续步骤失败，同样全体回滚。programs runs --limit 1展开原始回执，按不可变run ID去重实际阅读。原有schedule失败即停止，不后台反复尝试。

最多8个条件，整个definition仍最多12000字符；每次总条件计算量最多100000，视图本身仍受扫描和表达式预算限制。超预算拒绝，不能把局部结果当完整依据。没有条件的旧流程保留原语义；旧实验须运行者显式enable-program-conditions，先启用society kernel。

[programs 参数](../commands/programs.md) · [固定步骤与授权](programs.md) · [元能力](index.md)
`,
    'society/funds.md': `# 共同账户与真实支出

可以使用集体程序共同管理真实资金，也可以不使用。普通records里的余额不是这个账户。funds open --id 自选账户ID --collective-id 已激活集体ID --title 原话 只能由当前成员创建，初始余额为0；发起人没有个人提款权。

funds list 只列本人当前参与的控制集体账户。funds read --id 账户ID 提供收款地址、名称、状态、revision和controlVersion；当前成员还能看实际balance。非成员知道账户ID也可自愿入资，但不能因此看到余额、全账或获得成员/股权/债权。

funds contribute --id 账户ID --expected-revision 当前revision --amount 金额 --note '出资说明' 真实扣本人余额。入资只在open状态接受；其他操作更新revision后须重读，不可冒名付款。

支出用 collectives propose 的 resource action：{"kind":"resource","capability":"funds.transfer","resourceId":"账户ID","arguments":{"controlVersion":1,"recipient":{"sector":"agent","id":"真实收款人ID"},"amount":5,"note":"支出原话"}}。这只是格式；金额和用途由居民自己决定。收款sector可为 agent、collective、enterprise、treasury；国库ID必须 public-treasury。给企业资金不自动买入股份。

提案通过后 collectives execute --id 决定ID --expected-revision 决定当前revision 才真实支出，账户变化和凭据消费一起发生。缺钱/过期/章程改版/状态改变时全部拒绝，失败不消耗决定。新入资不改变controlVersion，未过期的同一精确决定可在补资后再执行。不能修改收款人或金额；需要另建提案。相同request-id重试返回原结果，不能重复付款。

清算先通过 {"kind":"resource","capability":"funds.beginSettlement","resourceId":"账户ID","arguments":{"controlVersion":当前值}}；执行后停止新入资，controlVersion提升。用新的controlVersion通过精确支出，逐笔处理清算；余额为0且无未处理义务后，通过并执行 funds.close（同样只有controlVersion参数）。关闭不会分配或销毁钱，不会抹掉历史。

funds ledger --id 账户ID --limit 10 供当前成员查询真实交易、实际账户revision和决定来源，按本账户版本顺序分页，最多30。全量页过大时减小limit，避免把截断原文当完整账目。个人只对自己的转账/收款形成实际经历；别人的余额和私密章程不随收款广播。

每集体最多20个账户；余额最多10亿、单次转移最多100万，所有数值finite且可可靠表示。每账户最多10000次入资，限额不会阻止已有资金支出和清算。关闭历史仍可查询。旧实验运行者须显式 enable-common-accounts，并先启用collectives。

[funds 参数](../commands/funds.md) · [集体程序](collectives.md) · [元能力](index.md)
`,
    'society/collectives.md': `# 居民自己的共同程序

可自行决定用途，不要求成立任何特定机构。town collectives list 可发现本人创建、受邀或仍参加的章程；read 展开，history 分页看自己有权读取的旧版本。决定用 decisions --collective-id，原文用 decision --id。

create 的 --configuration 是单引号包围的完整 JSON：{"title":"自定名","terms":"章程原话","members":["本人ID","另一人ID"],"voters":["本人ID","另一人ID"],"threshold":2,"quorum":2,"timing":"early","revote":true}。例子只说明格式，不是建议制度。members 必须含发起人，voters 是成员子集；threshold 为最少赞成人数，quorum 为最少回应人数（含弃权），且 quorum >= threshold。timing 可 early（达门槛可结算）或 deadline（只能到期）；revote 决定截止前能否改票。

create --id ... --configuration 'JSON' --expires-at 模拟毫秒 只记录自己的接受；其他人用 respond --id ... --expected-revision 当前版本 --accept true/false 独立选择。全体接受才激活；发起人可 withdraw 筹备。系统不把群聊成员或名册字段当成已经加入。

propose --id ... --collective-id ... --expected-version 章程version --terms 原话 --action 'JSON' --closes-at 投票截止 --execute-before 执行截止。提案原文不可原地修订，另建 ID 即新提案；提案人不会自动投赞成。动作可以 {"kind":"statement"}，或 {"kind":"amend","configuration":完整新配置}。resource 可连接[共同账户](funds.md)、[资源与企业管理](resources.md)、[实际生产](materials.md)及其他已有领域，具体操作须所属真实资源adapter可用；未实现操作明确拒绝。

vote --id 决定ID --expected-revision 最新版本 --vote yes/no/abstain 只代表自己。先读再投，不能覆盖别人回应。decide 只按冻结的名单/门槛/时间计数；模拟截止也会收口。通过 statement 只证明程序通过原文，不证明原文正确，也不转账。

修订依旧章程通过。新增成员需 join --id 决定ID --expected-revision 最新版本 --accept true，本人可拒绝。随后 execute 才原子更新章程并消费决定；未全部同意时旧章程继续有效。新版本使旧的未执行决定失去执行权。历史同意记录保留原来版本，不伪造所有人重新签署。

leave --id 章程ID --expected-revision 当前版本 移除未来成员/选民资格并提升权限版本。冻结投票仍可如实收口，但真实执行复核最新权限。退出不转移资产、不抹债务、不分配余款。若剩余人不足原门槛，程序暂停，平台不降低门槛或指定接班人。

最多30名成员、个人累计创建20个集体、每集体20个开放/500个历史决定；期限最多30模拟日。所有时间为模拟毫秒。list 每页最多30；大原文页过长时减少 limit。这里的邀请不会自动写入其他人的已读或模型目标。旧实验由运行者显式 enable-collectives。

[collectives 参数](../commands/collectives.md) · [元能力](index.md)
`,
    'society/views.md': `# 居民自己的数据应用

可以用共享记录组织自己的目录、比较或统计；平台不替你选择指标，也不把结果变成世界事实。先 town views publish --help 查看完整参数。

--definition 是单个引号包围的 JSON 对象。最小格式为 {"sourceRegisterId":"自己的表ID","select":["字段"]}。可选 where、derive、orderBy、aggregate，其他字段拒绝。

- where 是全部满足的条件数组，例如 [{"field":"cost","op":"lte","value":5}]。支持同类型 eq/ne、数值 gt/gte/lt/lte、字符串 contains。
- derive 定义新数值列，例如 {"weighted":{"op":"multiply","left":{"field":"rating"},"right":{"constant":2}}}。支持 add/subtract/multiply/divide；引用只能是源数值字段，不能互相递归或覆盖源字段。
- select 列出要输出的源字段和派生字段。orderBy 例如 [{"field":"weighted","direction":"desc"}]；同分按原始 key 排序。这是作者自己的算法，不是官方信誉。
- aggregate 例如 {"op":"mean","field":"weighted"}，或 {"op":"count"}。聚合计算整个有权读取且筛选命中的源集合，不只计算当前页。空集合 sum/count 为0，其他为空值。

title、visibility、readers 由作者选择。view可见且源表当前可读，才能读取或执行；公开view不会公开私人表。作者自己失去源权限也无法续读。

town views list 列元数据；read 展开定义；query --id 视图ID --expected-revision 精确版本 --offset 0 --limit 10 执行。结果包含作者、view版本、源表版本、扫描/匹配数、原始条目key/版本和居民陈述来源。重复查询不写账或改变身体。

revise 需要作者与最新版本，生成新定义并恢复active；disable 停止之后的查询，history保留当前有权读取的旧定义。旧实验须运行者显式 enable-record-views，且先启用shared records。

每作者最多20个视图；最多8个筛选、8个派生字段、16输出列、2个排序；表达式深度4、总节点64；每次扫描最多1000条源记录、100000求值节点，分页最多30。除零、溢出或超预算拒绝整个查询。结果太大时减小limit，不把截断数据当完整结果。

[views 参数](../commands/views.md) · [共同记录](records.md) · [元能力](index.md)
`,
    'society/records.md': `# 共同记录：共享记录簿与结构化数据

town registers create --help 查看结构。--fields 是单个引号包围的 JSON 对象，例如 '{"note":"string","amount":"number"}'。字段名称由你选择，类型限 string/number/boolean；所有字段必填，不接收嵌套对象。文本每字段最多2000字符。

- create 指定 id/title、public/private、readers 和 editors。数组通过重复旗标传入；空数组省略。owner 和 editors 可编辑；readers 可读；public 对全体可读。授权不表示对方加入组织。
- town records put --register-id 表ID --key 条目ID --expected-revision 0 --values '{"note":"原话","amount":5}' 创建。修改需最新条目版本；字段值不会改变真实余额。
- town records append --register-id 表ID --values 'JSON对象' 自动生成条目 key；同一个 request-id 重试不会再追加。
- records list --register-id 表ID 只列元数据；records read 用 --key 展开；records history 分页查看原始版本。records delete 是带版本的撤下，不删除历史。
- registers configure 需 owner 当前版本，更新 visibility/readers/editors。撤权阻止新读取和编辑，不能删除别人已经读到的记忆。
- registers nominate 指定 --successor-id 和 --expected-revision；接任者必须本人 registers accept 才交接。configure 取消未接受提名。旧 owner 后续权限取决于显式 ACL。

createdBy/editedBy/authorityId 标记实际创建者、实际编辑者和权限来源。委托编辑不会冒充授权人亲自写作。表中“已付款”“高信誉”“已加入”都是作者说法，不能直接成为世界事实。

[registers 参数](../commands/registers.md) · [records 参数](../commands/records.md) · [元能力](index.md)
`,
    'society/programs.md': `# 居民定义的有限流程

你决定用途；平台不从自然语言猜测操作，不要求你采用任何组织。

## 定义与查看

town programs publish --id 自选ID --title '自定名称' --purpose '目的原文' --runners 执行人ID --definition 'JSON对象'

definition 形如 {"steps":[{"principalId":"实际授权人ID","capability":"payments.transfer","arguments":{"targetId":"收款人ID","amount":5,"note":"付款原话"}}]}。

这是格式示例，不是付款建议。替换为真实居民 ID。可选conditions格式见[条件与署名依据](conditions.md)；旧实验须显式启用。最多8步，执行顺序固定。基础步骤：

- payments.transfer：targetId、amount、note。来自 principal 实际账户；金额乘授权次数是总支出上限。
- messages.send：recipientId、content。完整原话被授权；回执保留 principal 发送身份、实际执行人、授权 ID 和流程 ID。
- records.put：registerId、key、expectedRevision、values。必须匹配最新条目版本和当前编辑权限。
- records.append：registerId、values。每次运行生成独立稳定 key，适合重复记录。

arguments 必须精确包含上述字段，不接受 actorId、额外权限、脚本、递归或模型判断。不自动执行移动、劳动、治疗等身体行为，它们仍可由本人使用既有 CLI。

显式启用 resident-program-actions-v2 后，definition 加上 "actionPolicyVersion":"resident-program-actions-v2" 可使用 resource.control。先 town rules read --id resident-program-actions 查看是否启用；旧实验由运行者 enable-program-actions，不是居民命令。

resource.control 的 arguments 为 {"resourceKind":"space","resourceId":"实际资源ID","expectedRevision":当前修订,"control":{"type":"offer","expectedVersion":当前控制版本,"target":{"kind":"resident","id":"接收人ID"},"expiresAt":到期模拟毫秒,"terms":"移交原文"}}。accept/cancel 只需要 control.type 与 expectedVersion。种类支持 premises、stock、space、register、view、group、service；service 还需显式启用 resident-service-control-v1。须按对应 CLI read 查询真实版本。当前只开放个人控制主体的程序组合。

新实验可显式启用resident-program-actions-v3，允许resourceKind为enterprise；企业expectedRevision和expectedVersion都来自resources read的当前管理版本。旧实验由运行者enable-enterprise-programs单独升级，原manifest及已签v2程序不改写，v2仍不能写enterprise。企业交接只转管理，股份、现金、物品、雇员、工资和合约仍在原企业；付款不自动成为股权认购或公司收购。

可以自行把卖方 offer、买方 accept、买方 payments.transfer 放入同一固定程序；每位 principal 独立授权这一版全部步骤。后续步骤读取前一步后的真实版本。全部步骤成功才提交，否则钱和资源都保持运行前状态，成功次数也不消耗。不会在中途留下可被第三方接受的报价。已在程序外存在的普通报价仍按其原语义，不能靠文本给旧报价追加收费限制。

programs runs 按需展开每步 principalId、executedBy、mandateId/revision、程序修订、步骤索引与实际事件摘要指纹。代执行不会成为本人到场、签名观点或投票。控制交接不更改原作者、已有内容、地点、现存许可或其他聚合的义务。车辆和集体程序组合尚未开放；不得把它们伪装成上述资源种类。

programs list/read/history 查看自己拥有、可执行或需自己授权的版本。programs revise 仅 owner 可执行，需最新版本；修订使旧授权失效，历史保留。programs disable 停止未来执行，不撤销既往事实。

## 本人授权

每个 principal 都须自己使用 town mandates grant --id 自选授权ID --program-id 流程ID --program-revision 精确版本 --runner-id 指定执行人 --max-runs 次数 --expires-at 模拟时间。

先 programs read 理解固定步骤。作者自己的步骤也要授权。不能转授权或修改参数扩大权限；可 mandates revoke --id 授权ID --expected-revision 最新授权版本。成功运行会增加授权 revision，先重新查询。授权不锁钱，后续可能缺钱或失去访问权。

执行人 town programs run --id 流程ID --expected-revision 精确版本。全部步骤一起成功，或全部不发生。失败留记录，授权次数不消耗；回执不含他人余额/私密条目。重试保持相同 request-id。

## 时间与失败

town programs schedule --id 计划ID --program-id 流程ID --program-revision 版本 --start-at 未来模拟毫秒 --interval-ms 间隔 --runs 有限次数。

仅 runner 本人可安排。间隔至少60000模拟毫秒；最多100次，末次须在30模拟日内。每次重查授权/余额/ACL；任一次失败就停止，由你决定是否修订或重新安排。不会暗中重试。

programs schedules 查看自己的计划；programs cancel 用计划 id 和最新 expected-revision 取消未来执行。programs runs 查看相关执行事实；memory 检索参与经历。时间不是现实 UTC。

签署章程、文档说“同意”、程序 published，都不等于 grant。主观满意、信誉和组织成效由居民判断。

[programs 参数](../commands/programs.md) · [mandates 参数](../commands/mandates.md) · [元能力](index.md)
`,
  };
}

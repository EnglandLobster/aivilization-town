# 出行参与者退出与实物保管接续

状态：原诊断已复现；行程中断领域原语已验收，车辆world中断/退出候选已通过工程切片验收。保管接续及完整运行时功能尚未验收。不得以测试通过声称承运人退出已支持。完整目标包括途中人/车/货位置、原运费和责任、独立接受接续、运行时原子提交、旧世界兼容与全模式接入。

## 初次诊断证据与根因（后续修复见文末）

`residentTransportDepartureGap.test.ts`从实际材料预留、货运offer/accept/fund/load及可选vehicles.drive开始，再输入原死亡capture：

| 场景 | 已确认行为 | 缺口 |
|---|---|---|
| 载货车辆停在出发地，承运人退出 | prepareResidentEmploymentDeparture会返回accepted；原货物和8元托管仍在；有驾驶权限的friend无法开走货车或退货 | 编排只查活跃身体占用，没有让原运输责任进入可接续状态 |
| 载货车辆已出发，承运人退出 | 完整候选拒绝残留transit；若外层先capture删除身体，车辆保留journey，到达时advanceResidentMobility返回空 | 人体transit被删除，但车辆到达依赖已不存在者的位置；永久挂起 |

两例都保持原货物和现金守恒、拒绝冒充本人或无权替换承运人；这证明现有安全约束的必要性，不证明可用闭环。诊断没有改变真实实验journal，也没有开启人口模式。

根因有三层：

1. **位置表示**：agent.locationId在旅行中仍为出发节点；实际旅行事实在transit。capture只取locationId，不能把途中位置当成已回到起点。车辆journey仅含from/to/time/people，没有中断与进度事实。
2. **角色表示**：FreightTerms.carrierId同时承担原协议签约人、当前实际保管人、允许操作人、收款人。直接改它会重写原协议及收入归属；不改它又无法在本人退出后接续。
3. **编排顺序**：雇佣退出候选的身体busy检查不等于运输义务检查；先删人再到达结算也无法保证实体同步。

## 必须保持的边界

- mobility拥有车辆/行程的真实运动、司机与乘客参与；world拥有共同路线与模拟时刻，不由自然语言描述发明到达。
- logistics保留原FreightTerms不可变、原托管/履约责任和可审计的当前保管授权。原签约人、实际接手者、费用受益人必须可分别表达；不能把换驾驶人视为合同自动转让。
- materials仍是唯一实物数量来源。接续保管不能复制货物、释放源退回或目的接收空间，也不能把货物塞进个人可消费背包。
- authority/原资源领域验证车辆、接收空间和实物操作权限；驾驶许可不包含他人的货物保管权，继任资源控制也不自动构成新人的劳动同意。
- 原人退出只结束未来本人参与；不自动指定继任人、雇佣救援、变更运价、免债或产生赔付。居民通过已有组织/协商能力形成接续方案；底层只执行明确同意与实际动作。

## 实现顺序与交付门槛

1. 在原路线事实中记录可确定回放的中断边界/已完成时间，保留人、车、货的关联。死亡不得延迟到目的地；不得伪造原地回退、到达、车辆瞬移或自主驾驶。尚无新位置模型时，不使用旧locationId冒充途中实物位置。
2. 分离原协议主体与当前实物保管状态；针对实际人口来源冻结未来本人权限，并保留责任、费用和实物。空闲载货与途中载货必须一起进入退出检查，不能只覆盖busy状态。
3. 接续须精确版本授权、接手者本人独立确认、实际地点/车辆权限/载荷验证；原条款修改仍需原合同规定的独立同意。死亡者不能再确认；没有有效接续权限时保留待处置事实，不自动制造权利。
4. world在单一候选批次协调旅程中断、其他同行者真实状态、实物保管、资金、最终资产capture及人口事件；调用者必须真实单事务提交。任何失败不得写部分前缀。
5. CLI只暴露实际需要的查询/确认/行动，不给LLM一个新“死亡处理工具”。本人看到有界状态提示，通过主动查询展开原约定、实际位置与未清责任。原始文本不成为执行授权。
6. 可选版本化启用；旧事件按原解释回放，旧在途状态必须有明确迁移前置条件，不补造司机同意、路线进度或初始资产。canonical/分区使用同一领域语义，分别验收。

必须覆盖：司机/乘客/步行承运者退出；零进度/中途/恰好到达；手提/车辆货物；未出发/已装载/退回途中；多人同行不误停无关旅程；原托管保留及退款/已赚费用；接续拒绝和独立接受；假位置、无驾驶权、超载、旧版本、重复事件；不复制实物、现金守恒、精确身体时间、旧快照回放、批次中途拒绝不变。工程证据、真实CLI/OpenCode和无剧情自由采用分别记录。

下一实现必须解决位置与保管角色的真实断点，不以单加拒绝门或另建运输平台替代。全部25项社会能力与长期责任/全运行模式范围不变。


诊断工程检查：3352全仓通过/1原跳过，lint、排序typecheck通过；最终中点测试文件另通过eslint与world typecheck。只修改测试/规范，未改package export或生产源码，本轮不重复build。证据 `evidence/SOCIETY_TRANSPORT_DEPARTURE_GAP_2026-10-07.json` 明确acceptance=false。


## 行程中断领域原语（领域切片验收通过）

mobility新增VehicleJourneyInterrupted事件和vehicle-journey-interruption-v1来源。事件只记录车辆精确修订、实际人口来源引用、参与者、停止时刻与已走毫秒；事件应用只为原journey添加interruption并递增车辆修订，不改变原from/to/people/预计时刻、车辆控制/载荷、订单或资金。该位置依据是原路线上的时间进度，不冒充已知坐标、到达节点或完整身体位置接入。

仅在原departure≤stop<arrival且原旅程未中断时接受。恰好到达须先走真实到达边界，不能重复中断。版本、系统执行者、参与者及来源不能为空；过期修订/非整数时刻/未来越界/重复/改写elapsed拒绝。人口决定由world核验，mobility不判断谁应该死亡或迁出。

advanceMobility与nextMobilityBoundary忽略中断旅程及关联的未完结接客订单，不制造正常到达、完成车费或超时退款。旧无interruption路径不变。普通VehicleChanged不能添加、去除或改写该中断，未来接续必须有明确协议。

领域原语阶段world拒绝单独提交VehicleJourneyInterrupted（vehicle-interruption-requires-atomic-transport-adapter），避免只停车却让人体按原时钟继续抵达。当前完整transportInterruption包的world接入见下节；无包事件仍拒绝。此内部事件不新增CLI或常态上下文，不改变任何manifest或启用自然人口。

5个领域用例覆盖零/中途/到达前、拒绝与迁出来源、真实下单接客后中断不退费；1个真实world货运fixture验证拒绝半套事件且状态不变。原车辆/货运与缺口诊断一同回归，不能把这一领域原语等同于运输退出功能验收。下一仍按上文完整契约实现world位置/身体与保管接续。


领域原语最终检查：24针对、3358全仓通过/1原跳过，lint/排序typecheck、worker及依赖build通过。6新增测试实例。worker对新事件采用显式分支，在world原子adapter开放前不投递部分事件的居民经历或回执。证据 `evidence/SOCIETY_JOURNEY_INTERRUPTION_DOMAIN_2026-10-07.json`，完整transportAcceptance仍为false。


## 车辆world中断与退出候选（工程切片验收通过）

ResidentMobilityCommitted可选transportInterruption绑定真实人口来源、车辆和每一位同行者原始transit；必须与唯一VehicleJourneyInterrupted同包。world逐一核验原旅程/身体/实际travel时间预留/当前模拟边界和来源，精确停止车辆与所有同行旅行并截断未来独占时间。其他居民、货物、订单与原车费托管不变。

原在途记录从自动到达队列移到interruptedTravelByAgent，保留完整route、时长、拥堵事实、车辆及人口来源；身体locationId置null，表示不再声明位于原城镇节点，而非赋予自由初始放置。停止记录在本人退出后仍保留，背包capture不再误写出发节点。当前是路线时间位置依据，尚不提供救援坐标、接手或恢复移动。

普通AgentMoveTo、AgentTravelStarted及AgentLocationChanged不能绕过中断位置。车辆保持原journey.interruption，原车辆locationId仅是旅程anchor，仍不能当作可在出发地装卸/开走的空闲车辆。已冻结车辆不自动到达，正常世界时间推进不再生成同行人到达；不把时间推进当作恢复行程。

退出候选在capture前应用上述单事件，最后才删除身体。真实runtime单事务提交与自然人口尚未接入；步行承运、停放货物的接手、后继司机独立同意和恢复路径仍须继续。原先capture-first的挂起诊断继续作为错误顺序证据，不再描述当前完整候选为必然拒绝。

快照可选字段缺省不改变旧世界，createWorldProjection深复制新字段；canonical组合登记为agreement，与mobility/退出聚合一致，不能据此声称分区执行已完成。实际同行人是事件回执/经历的接收范围，未增加常态上下文段或CLI命令；尚无实际运行时提交或OpenCode验收。

新增3个world组合：零时刻/中点司机退出时路线保留、资金与库存守恒；真实下单/托管/载客后司机退出，存活乘客继续推进时间仍不抵达，普通移动拒绝。缺packet、丢失同行transit、重复事件拒绝；旧独立事件拒绝用例保留，域与应用版本回放一致。原已停放载货接续缺口仍保留，不能以这次车辆中断取代保管接续。


车辆world切片最终门禁：6项定向（包含原错误顺序诊断）、3361全仓通过/1原跳过，lint/排序typecheck/worker依赖build通过；3新增正向world组合。证据 `evidence/SOCIETY_VEHICLE_DEPARTURE_WORLD_2026-10-07.json`。transportAcceptance=false：步行、停放载货、独立保管接续/恢复和实际runtime原子人口事务仍未完成。

## 接续前的居民感知与授权边界

源码核对：collaboration普通Proposal.terms是原文，status=accepted不能成为新的实物/车辆执行权。program授权则绑定精确程序版本、principal、runner和可撤销限次mandate，但不能把本人开始/接手身体活动交给程序冒充。接续实现必须组合已有有效授权/独立确认与所属领域的实际行动校验，不能另造一个通用投票引擎，也不能从文件标题或“大家同意了”的描述推断权限。

现有缺口之一是中断状态虽保留在world，却没有进入居民action查询。worker现增加interruptedTravelContext读投影：只读本人interruptedTravelByAgent记录。无记录时保持旧输出不变；有记录时常态action和行动回执增加一条提示（状态、车辆ID、停止时间、需要有效接续、展开CLI），不包含原路线、其他人或完整人口来源。

主动 `town city observe --view action` 返回本人原始transit副本、实际elapsed和最小来源引用（版本/人口事件ID）。它不是执行授权，不改变世界，不制造当前位置节点或未来到达，也不宣称恢复命令已经可用。以后恢复实际落地仍须单独交付CLI与权限/位置校验，不以本查询替代。

预算与阶段：仅本人当前一条记录，不遍历全城、不注入中断历史；无需排序/分页。常态只在原opportunity-start/explicit-refresh的action段展示固定字段，行动回执同样只给提示；正文由既有主动查询展开。查询过的正文可能保留在供应商会话历史，后续常态省略不等于删除历史。未改其他planning stage或默认技能全文，也没有新增世界CLI路由。

2个新增读端口用例覆盖常态有界、主动原文展开、原对象不变/副本隔离、其他居民不可见和旧无记录输出；另回归3个contextDelivery用例。最终门禁：5针对、3363全仓通过/1原跳过，lint/排序typecheck/worker及依赖build通过。本切片不改变运输资金/库存或接手权限，不算接续完成。


本轮同时修正lint的产物范围：.local包含journal、供应商工作区与观察脚本，没有受版本控制的源码，现从源码lint排除；严格TypeScript/应用源码规则不变。上轮生成的观察脚本解析失败已被识别为此范围问题，没有删除实验或弱化领域断言。证据 `evidence/SOCIETY_INTERRUPTED_TRAVEL_CONTEXT_2026-10-07.json`。


## 物流保管接续领域状态机（领域切片验收通过）

logistics新增独立FreightCustodyState，只有交接提议和每票货物当前holder引用；不复制库存、合同、运费托管或产权。freightCustodian在未启用/无交接时读取原carrierId/vehicleId，成功交接后读独立holder；原FreightTerms始终不改，原费用受益人亦不重写。该阶段验收时为领域模块，未接WorldProjection/manifest/CLI；后续world接入见下节，不会隐式升级旧世界。

freight-custody-handoff-v1明确绑定货运修订、前后保管人、目标载具、付款主体控制引用、截止时间和实际署名。source/recipient/payer分别通过authority现有Controller授权端口确认；前保管人在世须本人同意，实际退出须由world提供本人匹配的人口来源引用。新保管人必须本人accept且实际takingFailure端口通过，不能由集体程序代替身体接手。执行前重新核验各署名者仍存在、集体决定仍有效且精确decisionId不变；不把一次历史代表身份当永久权限。

该特定资源交接的多方许可是版本化的初始契约执行规则，不宣称来自自然法则；启用时须明示其来源。普通collaboration原文不会被解析成这些许可，也不建立第二套通用章程/投票模型。货主、合同相对方的物权/约定变更与新人的劳动同意分别校验。退出事实免去不可能取得的前保管人新签名，但不自动转移其现金权益、取消旧责任或指定接手人。

提议者、未来接手者或已有署名者可撤回未执行交接。每个签名绑定同一不可修改提议；修改货运、控制人、原保管人、到期或来源变化均使旧确认失效。applier校验精确修订、不可变条款、单次新增署名、撤回人及最终本人执行者；重复事件/改写同意拒绝。库存和付款只有所属domain/world端口才能改变。

5个新领域用例及8个原货运用例覆盖真实意义上的独立确认、物理端口拒绝、前人退出来源、原条款/资金不变、事件回放、篡改、到期/改版、撤回与集体授权失效。物理端口目前是领域测试桩，不是实际同址、车辆或载荷已接通的证明。接下来的world adapter必须从实际材料custody/中断位置/驾驶许可读取并原子提交holder变更和材料保管证据，逐一替换当前把f.carrierId当实际操作人的读取；费用仍走原合同来源。未经该adapter核验的模块事件不得加入运行journal。

CLI接入、资源权限证明消费、当前holder查询、收付端口/实物/位置一致性、接手后的恢复行程与完整人口事务仍在原目标内。此模块的休眠是明确的分层实施状态，不能作为完整交付。


物流保管领域最终门禁：13针对、3368全仓通过/1原跳过，lint/排序typecheck/worker及依赖build通过。5新增用例。证据 `evidence/SOCIETY_FREIGHT_CUSTODY_DOMAIN_2026-10-07.json`，worldAcceptance=false；当前不声称真实物品已换保管人或已有可用接手CLI。

## 停放货物的 world 接续闭环（2026-10-07）

新增显式 `enableResidentFreightCustodyEvent` 和 `residentFreightCustodyEvent` 内部应用端口，使用 `ResidentLogisticsCommitted.custody` 可选版本包。旧物流状态没有 custody，不自动升级；同一事件只能启用或写交接，禁止夹带经济、材料或其他物流效果。新 holder 是实际材料保管的操作权限引用，唯一实物仍归 materials，交接不复制库存或改写原合同。

world 在接手时读取实际材料 held、前保管人/退出捕获地点、车辆真实位置、双方闲置与当前驾驶许可，并合计其他货物和个人背包载荷。行程中断的原起点不是当前位置，因此在途/中断状态不能使用停放交接接口。前人真实退出可由匹配的 residentExits 来源核验；物品有停放载具或明确退出地点才允许本人接手。没有地点不会猜测或瞬移。

本人 load/deliver/return、随身载荷、车辆货物、驾驶检查、驾驶授权撤回保护、场所取送货进入权限和车辆转让义务都改为读取 freightCustodian；运费受益人保持原 FreightTerms.carrierId。worker 原 freight.read 的按需查询显示 currentCustodian，并按当前人/车辆读取货物位置；新保管人可读取自己承担的货运。未新增每轮上下文或工具列表。

个人之间实际闭环覆盖手提和车辆：独立确认→本人现场接手→真实出行/到达→交付，原承运人失去操作权，原合同仍收款。另覆盖前承运人退出后的停放货物接手/真实退回，费用进入原主体 estate，退款回原付款人，接手者不自动领取原费用。交接事件的 stock、现金、身体不变；后续交付通过原材料/账务端口，事件可回放。

**明确未完成**：集体主体目前返回 `custody-collective-grant-adapter-required`，需要绑定现有精确集体决定的持久许可与原子消费，不能接受调用者虚构 decisionId。worker 命令、CLI、manifest 迁移、在途恢复和自然人口 journal 事务尚未接通。新端口仍是内部实验装配能力，不代表 canonical、分区或 OpenCode 已验收。完整目标不缩减，下一直接接这些路径，不新增运输商业玩法。

停放个人接续最终门禁：5新增world组合、13针对、3373全仓通过/1原跳过，lint/排序typecheck/worker依赖build及diff检查通过。证据 `../evidence/SOCIETY_FREIGHT_CUSTODY_WORLD_2026-10-07.json`；world个人切片通过，transportAcceptance=false，未运行新的OpenCode验收。

## 居民入口与显式 journal 启用（2026-10-07）

个人停放接续通过既有认证/runtime/journal 路径接入，两条按需 CLI：`town freight handoffs --id ID` 分页查看本人有权阅读的提议；`town freight handoff --id ID --handoff-id ID --action propose|consent|accept|withdraw` 执行精确步骤。身份来自会话绑定，schema 不接受 actorId；提议版本与货运版本分别呈现，不把署名动作当作劳动接手。普通程序/集体代理均不能代人执行接手。

运行者 `enable-freight-custody --root DIR` 通过可重试 system journal commit 显式启用，记录 freight-custody-handoff-v1；不写入历史 manifest，不增加货物/车辆/驾驶权或同意。`freight.rules` 显示 enabled、协议来源、个人停放支持范围及集体授权未接通。能力边界的 freight-custody availability 独立于 logistics；货运已启用不等于交接已启用。Skill v71 和 Rulebook v58 同步，将这套初始多方许可协议明确标为 initial-institution，与材料守恒/有限载荷的物理规则分开。

接手邀请仅在未撤回、未到期、货运版本及前保管人仍匹配时，允许被提名者主动读取对应约定；不会授予其他货单或他人的所有交接提议。历史本人参与提议仍可查，邀请结束不再提供新的货物当前位置访问，已获取原文可能保留于供应商会话历史。查询分页30条，按时间倒序再ID稳定排序；不新增常态上下文段、自动唤醒或认知摘要。

该入口把上轮内部能力变为个人可执行链；集体持久授权和精确决定消费、在途恢复、自然人口完整journal事务、canonical/分区仍是未完成项。编排脚本和命令验收不等于自然社会涌现，不预设运输组织或接手动机。

个人CLI接续门禁：3新增runtime测试、41针对、3376全仓通过/1原跳过，lint（含最终修改文件复查）、排序typecheck、residents及全部依赖build通过；生成的Skill页面同步。编译后真实CLI/HTTP脚本44调用，37成功/7预期拒绝，独立同意、邀请读取、本人执行、重复请求只生效一次、原收款人、实际出行交付、车辆退回与journal重开/字节一致均通过。证据 `evidence/SOCIETY_FREIGHT_CUSTODY_CLI_2026-10-07.json`；modelInvoked=false，transportAcceptance/canonical/partition/emergence均不因此变为完成。

## 集体的精确持久许可（2026-10-07）

`freight-custody-collective-grants-v1` 通过独立 `enable-collective-freight-custody` journal 事件启用，前提是已有个人接续与 collectives。旧个人协议不自动获得集体权限；显式启用仅增加可核验许可路径，既有货物、现金、车辆、manifest及已发生事件不改。`freight.rules` 按实际状态披露个人/集体支持范围；Skill v72/Rulebook v59同步，不新增居民工具。

集体仍使用现有 `collectives.propose/vote/decide/execute`。resource action 精确绑定 `freight.handoff`、货运ID、提议ID、动作及完整参数；可以代表所属 source/recipient/payer 提议、同意、撤回，不能代替下一承运人 accept，也不能给未属于该集体的角色签名。worker 复用现有 collective 执行流程，返回所属物流事件和唯一决定消费，统一 journal 同批提交。

world 接受只读 FreightCustodyCollectivePort；来源由 collaboration 状态和精确 action 核验，不能信任事件中的 decisionId 声明。重放要求当前新签署/提议/撤回对应同批、唯一、内容相同的 CollectiveDecisionChanged。缺消费、仅消费、一个消费绑定两份效果，均拒绝；没有端口的普通 world 回放不能重放新集体许可。

同意一旦消费，其后是已执行的精确许可，不再要求原决定仍为 passed，也不重复消费。accept 时核验已执行决定的原 collective/actor/提议ID/货运ID/role/版本参数及当前章程版本；消费窗口只限制最初执行，不自动撤销已执行许可。许可仍受提议到期、条款/保管人变化、整份撤回和章程改版约束。历史代表死亡不等于集体许可消失，不要求代表再次本人行动。

集体提议记录实际 createdBy 及 createdByCollectiveId；集体撤回记录当前授权来源。历史代表不能以作者或旧署名永久绕过集体执行权限，新的合法代表可依新的精确决定撤回。个人前保管人、接手者及个人签署者的本人退出权仍依原协议保留。完整撤回停止未执行接手，不撤回实际劳动、不抹除 cargo/escrow/历史同意。

开放 runtime 和 journal 已接入外部授权端口；canonical/分区必须从各自真实集体状态注入同语义端口才能启用，当前未接入的路径继续拒绝，不把字符串证明当授权。中断旅程恢复、自然人口完整事务、长期全模式验收仍未完成。

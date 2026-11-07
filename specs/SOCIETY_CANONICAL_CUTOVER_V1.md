# Canonical 到完整居民社会的权威切换

属于 R01/B02，完整范围包含旧数据、策略、认知、接口与分区，不以单个检查器代替迁移。

## 已确认的边界

`simulationWideAuthority` 保存全局交易真相、居民分区归属、待交接、投递游标和去重操作；分区仍拥有本地生活结算与认知。`localSimulationRuntimeHost` 先消费全局收件箱再发布本地状态，避免陈旧余额覆盖已成交事实。全局 projection 不是任意时刻都完整的新世界快照。

开放 `OpenSocietyRuntime` 的 journal 原子保存所有社会领域，启动还核对固定策略来源。直接把 canonical projection 塞进 integrated manifest 会漏掉分区历史和运行责任，并可能改变策略；禁止这样迁移。也不把384个居民操作追加到旧候选动作生成器充当集成。

## 完整切换链

1. 检查原权威与全部分区的时间、归属及投递屏障，列出具体阻塞；只读检查不停止写入、不消费投递、不修改状态。
2. 运行者明确停止并持久围栏旧 writer，在同一冻结边界导出全部原权威、分区事件/认知/操作去重与版本化策略；检查前后摘要和 fencing，静态检查成功本身不证明已停机。
3. 按字段来源构造完整组合状态：全局结算用 authority，个人本地状态与认知用其唯一 owner；原文、义务、在途、活动和账户不得缺失、重复或按新规则重算。未映射字段拒绝，不静默忽略。旧 planner 的未执行意图作为历史而非居民同意或待执行命令。
4. 独立版本迁移记录保存来源、差异和原策略解释。新规则的生效另需明确版本与启用事件；不补造车辆/土地/同意/初始现金。新居民模式继续使用 town CLI 与自由决策。
5. 新目录原子发布，旧目录永久保留来源及切换标记，禁止两边同时继续写。重复迁移核对来源摘要，失败可恢复；目标开始新事实后不能无条件回滚旧世界。
6. 正式 server、分区计算、原观察接口/界面按同一权威读取；认证不继承旧actor参数或管理token。完成资金库存、所有领域责任、时钟、会话/认知、原历史回放、故障恢复、真实CLI与OpenCode验收后才能称完整迁移。

## 首个必要屏障

`worker/canonicalSocietyBarrier` 只核对调用者提供的同一捕获批次，不进行I/O或授予切换权。输入必须是实际 `SimulationWideAuthoritySnapshot` 和每个声明分区的完整 projection。缺分区、重复分区、额外分区、时钟落后、缺owner、重复居民、owner记录与权威不一致、待交接和未消费投递均报告稳定原因。来源缺失是阻塞，不是空世界。

屏障检查通过仅表示这些运行事实互相吻合，不表示完整 projection 所有字段已合并，也不表示策略/认知/资产迁移或物理停机已完成。下一步必须接真实冻结导出与来源映射，不能只把该检查器作为最终交付。


## 首条屏障工程验证（2026-10-07）

新增6项检查测试，连同原authority的42项投递/结算测试共48项通过；全仓3213通过/1原有跳过、482文件通过/1跳过，lint、排序全仓typecheck、worker公开导出构建与格式检查通过。所有检查不写领域事件、不改变余额/库存，旧投递调用复用同一个纯读取函数，未修改旧事件解释。

首轮全仓有一项既有教育测试30000ms超时，其余3212通过；保持原测试与时限，独立复核约11秒通过，再单独全仓58.34秒通过。保留初始失败与复核日志，不将资源竞争推测写成已剖析的根因。测试夹具最初误用不存在的分区转换函数及projection字段，已按真实类型修正，无弱化断言。详见`evidence/SOCIETY_CANONICAL_BARRIER_2026-10-07.json`。

当前公开工程函数尚未接运行者冻结导出CLI，没有进行本阶段真实模型迁移验收。下一阶段必须继续实际冻结/全来源导出及唯一writer切换，不将本检查器验收作为R01完成。

## 离线完整来源归档

正式server CLI新增运行者入口：`export-society-source --source DIR --target NEW_DIR --confirm-source-stopped`。server adapter负责文件归档，不进入domain或居民能力目录。全树保留原事件、认知、配置、未知扩展和空目录，不改URI、不hydration、不把待交接标为完成。初始扫描、复制验证、持久化前再次检查来源；摘要只证明采样时字节一致，不能证明每个瞬间都没有写入。

当前canonical没有覆盖全部存储/在途操作的统一停机围栏；现有authority短期租约不能替代整个host的停机。`--confirm-source-stopped`是运行者声明，输出明确为`operator-declaration-only`，**不是程序已验证停机**。目标明确为`source-preservation-not-runnable-migration`，后续导入必须验证来源屏障、策略/字段映射及围栏，不得仅因归档验证通过启动新权威。

归档在同级私有临时目录生成，文件/目录fsync后rename发布；目标专用排他锁防止重复导出竞争。已存在目标只有全量字节、来源根和摘要相同时才幂等返回，否则拒绝且保留原目标。源/目标重叠（含父目录symlink别名）、源symlink/特殊文件、额外或损坏归档拒绝。复制失败只清理本次临时目录，不删除他人的目标/锁；不修改源。归档包含原有私有数据，入口仅为运行者，本次未发布到外部。

真正的writer冻结、全语义映射、目标发布与源退役仍继续原完整切换链，本归档不是该链的最终验收。


归档入口验证：7项测试覆盖完整字节/未知文件、幂等、损坏、路径重叠/别名、锁竞争、CLI声明与复制中源变化；全仓3220通过/1原跳过，483文件通过/1跳过，lint、排序typecheck、server构建及格式检查通过。真实编译CLI在`.local/canonical-source-archive-20261007`验收3次调用（1次预期拒绝）：独立子进程创建两个canonical分区、完成一次真实交易并退出，之后归档90个条目，原/副本逐文件摘要一致、重复导出不变。该受控子进程确已退出不意味着通用CLI拥有writer围栏。证据见`evidence/SOCIETY_CANONICAL_ARCHIVE_2026-10-07.json`，脚本`apps/residents/scripts/verify-canonical-source-archive.mjs`。

首次lint的类型导入/新脚本目录问题已按仓库约定修正，没有排除脚本或放宽规则。归档功能到此收口；下一步实际围栏与来源映射，禁止以归档成功替代完整R01。

## Canonical 有序关闭的在途任务边界

实际发现：原CLI的close只等待HTTP关闭，三个后台host的stop只清除未来定时器，已开始的worker/scheduler/recovery仍可写入。这不能作为导出前已停机的证据。

worker内部`RuntimeOperationDrain`登记每个已接收的异步操作，关闭后拒绝新操作并等待所有在途结果；失败汇总上报，不把失败当成功停机。三个host新增永久shutdown，原stop/start保持可恢复暂停语义；并发scheduler/recovery的inFlight按真实未完成操作统计，不因其中一个先结束而提前清零。worker仍保持原有单次领取互斥。

正式CLI的close先停止定时器、关闭HTTP接收并等待已接收请求，然后关闭调度/恢复生产者，最后关闭队列worker，保证已开始的恢复还能完成它需要的队列操作。即使HTTP关闭或某个生产者失败，也等待其余后台结束再汇总失败；重复close沿用同一个Promise。启动失败清理也等待后台结束，并保留原启动与清理错误。

这只建立本application拥有的有序关闭边界。直接持有底层repository/authority/host的其他进程仍可写；旧server.close仅关闭transport也不等于上述application.close。跨进程持久围栏、全部来源映射和迁移发布继续原链，不将此处shutdown等同于SIGKILL恢复或任意运行目录冻结。

自定义host实现须实现新增shutdown契约，不能用同步stop冒充完成；仓库内三个API替身已同步。持久世界事件、policy和资金/库存结算没有改变；本阶段新增8项测试覆盖多任务等待、同步异常/重入关闭、失败等待、暂停兼容、生产者/消费者顺序和真实HTTP application.close的等待与幂等。长连接未结束时HTTP关闭仍等待，不超时宣告成功。


有序关闭最终验证：全仓3228通过/1原有跳过、485文件通过/1跳过；lint、排序全仓typecheck、worker与server构建、格式与diff检查通过。初始测试lint与三个旧host替身的类型问题已修正并留日志，无削弱检查。证据`evidence/SOCIETY_CANONICAL_SHUTDOWN_2026-10-07.json`。下一步跨进程持久所有权/围栏与原事实迁移，R01仍未完成。

## 正式运行与归档的跨进程接收互斥

`server/canonicalRuntimeOwnership`按realpath后的运行根登记来源所有权，控制目录位于根目录的同级隐藏目录，不改世界资料。短时mkdir门闩串行保护登记；多个既有分区writer可共同登记，archive只能在writer集合为空时独占。archive持有期间正式CLI不能开始bootstrap；正式CLI从bootstrap前直到application.close成功一直持有writer，两个阶段不能同时开始。

记录使用随机token与实际PID，写入及删除同步到文件/目录；释放须匹配本次原记录，重复释放幂等。绝不按PID或wall-clock猜测删除陈旧记录；门闩/记录异常拒绝，不能借清理取得权限。成功关闭后释放，失败关闭保留；bootstrap失败可能存在未完成的并行分区初始化，因此也保留记录供后续显式恢复。已有完整runtime后的启动失败在确认后台全部结束后释放。此处尚无自动崩溃接管，显式恢复/源退役仍继续完整R01。

这是同一文件系统上采用该协议的正式CLI与归档入口之间的协作式保护，不阻止旧版本、直接调用底层库或人为改文件。原归档的`operator-declaration-only`仍保持，不能把历史或未接入的writer假装纳入保护。旧manifest及领域事件不变，多分区既有共同writer模式不被改成强制单进程；归档校验也不代替状态/策略/认知映射。


所有权验证：新增3项专门测试，并扩展application.close测试证明未结束时仍拒绝归档、结束后可归档且正式启动被archive持有者拒绝。全仓3231通过/1原跳过、486文件通过/1跳过，lint、排序typecheck及server构建通过。真实独立进程脚本`apps/residents/scripts/verify-canonical-ownership.mjs`在`.local/canonical-ownership-20261007`启动deterministic canonical daemon；运行中另一进程归档被拒且不创建目标，SIGTERM完成并以0退出后归档成功，重复归档不变。3次归档CLI调用含1次预期拒绝，非OpenCode或自由社会验收。完整证据`evidence/SOCIETY_CANONICAL_OWNERSHIP_2026-10-07.json`。

新脚本首次lint要求显式node:timers导入，已修正而未放宽规则。下一步继续异常记录的显式恢复、源退役与实际状态来源映射，不能因正式入口互斥通过就宣布完整切换。

## 实际WorldProjection来源组合

`worker/canonicalWorldComposition`以穷尽的`Record<keyof WorldProjection,...>`列出字段来源，新增世界字段必须显式决定迁移语义；运行时额外未知字段也拒绝。输入为同一捕获批次的authority与分区完整projection，先通过来源屏障，再核对每个分区的财政贡献确已发布。

全局市场、银行、财政、空间和全局制度事实使用authority；实际活动、身体困境与个人时间结算使用当前owner分区，不把一份时间投入算两遍。待处理求职/考试申请保留分区事实及原applicationId，身份/ID冲突拒绝；原authority已有申请不能因owner缺记录而消失。已退出居民的历史申请也保留，不制造活居民或新授权。

招聘/考试周期及其余尚未明确跨分区归并的领域，仅在各来源一致时保留；不同值明确阻塞，不猜测合并预算、名额或生命周期。尤其projection.memoryRecords只是有界缓存，不冒充完整记忆；完整ledger、长期画像与旧规划意图仍须单独迁移。候选world是脱离输入的只读组合结果，不创建新manifest、不执行事件、不选择新policy，也不启动新的writer。

当前正常来源组合不代替完整映射：跨分区制度差异、认知/策略、在途交接、源退役与完整目标仍继续。此阶段从基础设施前置回到真实数据接入，不扩展锁或归档旁支。


来源组合验证：新增6项组合测试通过；全仓3237通过/1原有跳过、487文件通过/1跳过，worker公开导出构建通过。该全仓运行在最后补齐验证脚本的sim-core直接开发依赖前完成；之后未修改生产实现。最终lint与排序全仓typecheck复核通过。

真实归档不能宣称组合成功：读取并逐文件复核已有25居民canonical归档，原FileEventStore解码73条事件，与快照检查点73一致；读取不修改归档或临时事件副本。来源仍有22个pendingMoves，均为同分区尚未结束的真实移动，因此屏障返回blocked、没有候选projection。这说明安全关闭只结束在途后台调用，不会把模拟世界的旅行判为完成。分区中另有3份求职申请而authority中为0，来源必须保留，当前真实归档仍未形成目标世界。

验证脚本默认仍要求composed；只有显式提供预期拒绝原因时才验收拒绝，且要求全部问题严格匹配、无候选结果。保留首次缺少直接依赖与随后move-pending失败日志；修正依赖及验证预期，未放宽生产屏障或篡改原旅行。详见`evidence/SOCIETY_CANONICAL_COMPOSITION_2026-10-07.json`。下一步必须承接尚未完成的世界行动及策略/认知，不能为了清空屏障而暂停之外推进原世界、瞬移居民或删掉pending记录。

## 原行程接续（same-owner-v1）

显式`movementContinuity: same-owner-v1`启用v2屏障：对每个未完成同分区移动，核对当前owner、原pending记录、原move操作及出发事件、authority与所属分区的路线/到达时间、个人真实时间占用。原操作必须仍为in-transit，不能夹带跨分区认知或交接事件。缺证据、来源不一致、已经到期而未结算的旅行仍拒绝。未显式选择时保留v1的全待移动拒绝行为。

通过时屏障附带独立克隆的原pending、原操作（含原requestFingerprint）、旅行和实际时间事实；候选world保留原transit，不提前完成、重新选路或重新定价。目标必须保存该来源接续证据，并由原时间/到达规则在原arrivesAt继续履行；不能把这些操作当作需要重发的居民意图。跨分区移动和pendingTransfers仍拒绝，归属与认知交接路径继续完整R01，不因此删除或伪装完成。

本阶段只是接续候选及到达语义验证，不启动目标writer；策略来源、全认知、全原操作去重、历史回放、退休标记和目标激活仍须完成。测试明确验证到达前1ms不完成、到期一次完成、之后不重复到达，并验证默认拒绝和跨分区/缺操作/本地状态冲突仍拒绝。


原行程接续验收：14项相关测试通过；全仓3239通过/1原有跳过、487文件通过/1跳过，lint、排序全仓typecheck、worker构建、格式与diff检查通过。真实归档显式接续生成候选：25居民、22个原行程、3份分区求职申请、moneySupply 257500，原归档字节不变；默认模式仍报告22个move-pending且无候选。上一节曾误写1份申请，已依据原机器报告及当前归档纠正为3份，未修改原数据。证据`evidence/SOCIETY_CANONICAL_MOVEMENT_CONTINUITY_2026-10-07.json`。首次测试夹具漏写真实消费游标及AgentId类型已修正，未放宽屏障或类型约束。

## 可执行策略来源接续

`CanonicalPolicyContinuation`保存显式版本、原seed、重建配置与完整原world policy manifest。执行前要求配置重建出的完整manifest与原manifest严格相等；未知配置键、错误seed、参数/版本不匹配拒绝，不能仅比较policyVersion字符串。配置重用原工厂及领域validator，工资等回调仍由原实现按当前projection生成，不把JSON中的函数空缺当作默认值。

OpenSocietyManifest可显式携带该来源，provenance.worldPolicyAdapter须为canonical-policy-continuation-v1。启动、时间推进、租约、生产/设施、企业与服务命令均传递同一来源。whole-world journal接入原authority天气/服务质量策略，不能在计算分区各自结算。独立居民rhythm与旧策略不能同时隐式应用，改变作息结算需后续显式迁移；原默认manifest分支不变。已经由真实启用事件产生的公共住房/就业/教育制度仍经过既有领域adapter。

这建立可执行接续端口，不等于已经证明某份外部配置是历史原策略：最终导入器仍须绑定来源归档/运行manifest/代码版本与原策略一致性证据；原manifest没有记录的自定义策略或时间摊销配置不得猜测。完整认知、去重、跨分区制度差异、source retirement和目标发布继续原范围。新增来源不广播进居民默认上下文，沿既有主动规则查询读取manifest/provenance。


策略接续验收：新增4项测试覆盖原计算结果/开关、来源和rhythm冲突、真实Runtime时间推进与关闭重开回放、非法来源启动失败后的writer释放。全仓3243通过/1原有跳过、488文件通过/1跳过，lint、排序全仓typecheck、worker构建、格式与diff检查通过。真实归档中的完整policy manifest与显式默认来源配置重建结果相等，Cleaner/CEO工资结果分别250/2263.244且与原factory一致，来源文件摘要未变；本验证不推断任意旧配置、不创建迁移世界。详见`evidence/SOCIETY_CANONICAL_POLICY_CONTINUITY_2026-10-07.json`。最初测试比较了回调对象身份而非计算结果、JSON类型标注不完整，已修正并保留日志，没有削弱领域或检查规则。

## 完整经历账本接续

`readCanonicalResidentMemory`通过memory公开repository端口，以原appendSequence每页128条读取各声明分区的每位当前居民，直到空页；不调用64条快速缓冲的retrieve，也不按occurredAt截断。跨页必须严格前进、属于本人、页数/条数合法；返回独立克隆并保留原分区、序号及整个原record，包括失败、修正、传闻/人为植入标签与原时间。多分区副本保留各自来源，不伪造跨分区全局顺序；完整来源冻结与分区集合由导入器负责。

可选canonicalMemoryContinuation进入manifest初始状态，通过原memory.search/read仅向本人开放。wrapper标为legacy-record，原记录保留在canonicalSource；不创建active cognition、执行旧human-command或推断为firsthand。搜索只显示有界摘要，不附带整个原record，按memory.read展开。默认上下文不注入历史正文，只在既有memories段显示总数/历史数量和既有查询入口；旧无此字段的manifest仍为空历史，不补造记录。

当前覆盖当前居民的完整短期经历账本，不把它称为完整认知：长期画像、意图及branch计划历史、已退出主体、来源绑定/去重、旧历史回放与目标发布仍继续完整R01。原归档保留所有这些文件；此处不调用getOrCreate补造画像，也不改变旧事件解释。首次接入使用manifest持有历史，已读取记录的总内存仍与历史量成正比，后续大规模接入需在同一完整性边界下使用索引，不以缩短历史解决。


经历账本验收：新增3项测试（601条超过快速缓冲及512条迁移窗口、原时间倒序、完整原record、本人读取/他人拒绝、无默认正文注入、重开回放、坏页拒绝及旧manifest兼容）通过。全仓3246通过/1原有跳过、489文件通过/1跳过；lint、排序全仓typecheck、worker构建、格式和diff检查通过。真实归档经原memory codec在独立临时副本分页读取25居民共25条记录，归档逐文件摘要不变；该真实样本不冒充601条压力证据。证据`evidence/SOCIETY_CANONICAL_MEMORY_CONTINUITY_2026-10-07.json`。初始夹具使用不存在的时间helper/遗漏context参数以及mock的async lint问题已修正并保留日志，无放宽校验。

## 已有长期画像与意图状态

memory的FileLongTermProfileRepository和FileAgentIntentionRepository新增只读find：缺失返回undefined，不使用getOrCreate写入空记录；已有资料由原repository解码并克隆。worker通过只读端口读取各来源分区每位当前居民的最新已有画像/意图，保留分区和整个原状态。不存在的资料不合成，同一主体在不同分区的快照不猜测合并为当前人格。

canonical-cognitive-documents-v1是历史资料集合。初始化通过本人memory.search/read访问，wrapper使用legacy-record；profile/intention原内容在canonicalDocument按需展开。摘要只是资料类型说明，不代替原文；捕获时间是快照边界，不能冒充其中每条观点/计划的形成时间。默认上下文仍只增加历史资料数量，不广播观点。原activeObjective/scheduledIntentions状态保留在历史资料，不注入active cognition、reminder、任务队列或授权，不执行旧计划。

当前读取的是原仓储重建出的最新已有状态，不是全部历史修订。原画像历史、意图增量记录、branch计划/进度原文件仍完整保留在归档；历史revision映射、退出主体、去重、目标激活与源退役继续完整R01，不能把这两种资料的可读性当作全部认知完成。


画像/意图接续验收：新增2项集成测试覆盖缺失find不写入、保留已有观点/置信度和active原意图、本人原文读取/他人拒绝、无自动执行或默认正文、关闭重开一致，以及错属主/重复分区拒绝。全仓3248通过/1原有跳过、490文件通过/1跳过，lint、排序typecheck、memory/worker构建、格式及diff检查通过。真实归档通过原repository读取25已有画像、25已有意图状态及25账本记录，原归档逐文件摘要不变。证据`evidence/SOCIETY_CANONICAL_COGNITION_CONTINUITY_2026-10-07.json`。未创建迁移目标或新的模型实验，最新状态之外的历史修订和branch计划继续原目标。

## 分支计划与已有执行进度

canonical-cognitive-documents-v2显式接入原BranchPlanRepository.query（无limit，扫描所有已存planId的最新状态）与BranchPlanProgressRepository.get。每份计划的原结构、编译/修订trace及已有完成/阻塞状态原样保留；缺失进度不调用getOrCreate补造。计划属主/planId、对应进度身份、重复planId及分区来源完整性校验，不把其他居民或另一计划进度拼入。

v2通过现有canonicalDocument和本人memory.read展开。资料ID增加原planId以区分同分区的多个旧计划；旧v1资料ID/解释不变，v1不接受新增计划类型。原计划保持历史资料，不放回planner或action队列，不制造当前授权。所有planning阶段仍无默认正文注入。

这读取各已存planId的最新状态及其已有进度，不等于每次历史修订或孤立进度都已映射。原原始日志始终在归档中保留，历史修订、无对应plan的进度、退出主体、完整源绑定/退役/发布继续R01，不能以最新计划集合代替所有原始历史。


分支计划接续验收：3项相关测试通过（含原画像/意图2项），新测试覆盖65个已存planId、64份已有进度与缺失不补造、完整原阻塞原因、本人读取/他人拒绝、关闭重开一致、错误进度/缺分区planning来源拒绝。全仓3249通过/1原有跳过、491文件通过/1跳过，lint、排序typecheck、worker构建、格式和diff检查通过。真实归档读出25份计划和25份对应进度，连同画像/意图/账本来源验证且原文件摘要不变。证据`evidence/SOCIETY_CANONICAL_PLANNING_CONTINUITY_2026-10-07.json`。尚未覆盖历次修订和孤立进度，更未激活新权威；完整原目标继续。

## 组合候选与真实归档临时运行

`createCanonicalSocietyCandidate`将原authority/分区组合、显式原策略、完整当前居民经历账本、画像/意图/分支资料与来源居民身份放入一份manifest。原世界直接复制组合结果，不调用新场景工厂、不重新播种资产/车辆/土地/教育。居民集合必须在world、身份、记忆和认知来源中一致；认知捕获时钟必须一致，记录来源分区必须属于已捕获集合。世界屏障失败不返回manifest，策略或认知非法在创建任何目录前拒绝。

候选使用新开放决策入口的明确基础策略/信息读写能力；没有隐式开启生活/社会领域模块或新rhythm。后续规则启用仍走显式版本事件。这里不是缩减完整社会范围：已有世界接续和新规则启用分开验收，全部25项、完整社会profile以及canonical/分区整合继续原目标。

候选本身不持久化、不激活writer、不退休旧源；也不代替完整源绑定、历史去重和全修订映射。工程验证可在独立临时目录打开候选、推进时间并重开，全部临时文件随后删除，不能称为正式切换。


组合候选验收：新增2项测试覆盖不播种世界、各来源集合/捕获时钟一致性、拒绝混入资料、隔离runtime推进与重开；全仓3251通过/1原跳过、492文件通过/1跳过，lint、排序typecheck、worker构建、格式与diff检查通过。真实归档候选含25居民、3申请、22原行程和125条历史资料；临时runtime从模拟时间7000推进到2728000，22原行程均到达原目的地且transit清除，重开回放一致，原归档逐文件摘要不变。全部临时运行文件清理，未正式切换或启动模型。证据`evidence/SOCIETY_CANONICAL_CANDIDATE_2026-10-07.json`。

## 归档仍保留的认知历史修订

memory与agent-runtime各自的原文件仓储新增readHistory，只读扫描已提交记录并返回原record、本人和来源行序号。意图复用旧snapshot/版本化增量记录解析，不将set-objective等原操作重新提交；画像、计划与进度保留原记录而不是只取最新值，进度不依赖存在同名计划，因此孤立进度也可保留。检测不完整末行时拒绝，不能把缺尾部称为完整历史。序号只定位这份捕获日志，不冒充压缩前的全局历史序号。

canonical-cognitive-documents-v3显式声明四种history来源，各分区缺任一种接入则拒绝；校验本人、原record属主与严格前进序号。最新资料和retained-revision分开存放，后者包含原日志类别、原序号和原record，通过本人memory.read展开；默认上下文仍只有数量。v1/v2保持兼容，新增类型不能混入旧版本。

范围为当前居民在归档中仍保留的记录。若原仓储以前做过压缩，已经删除的版本不能恢复，也不伪造；原归档完整保留字节以供审计。退出主体、全authority操作去重、通用源绑定/退役与正式迁移发布仍继续完整R01。没有把历史记录数增加当作新事实或社会涌现。


保留历史验收：新增集成测试覆盖旧画像、原意图增量及legacy snapshot、旧计划版本/孤立进度、本人访问与重开、四类不完整尾部拒绝。全仓3252通过/1原跳过、493文件通过/1跳过，lint、排序typecheck、memory/agent-runtime/worker构建、格式及diff检查通过。真实归档候选接入153条retained revisions，连同此前125条资料共278条可查历史（不是278个新世界事实）；临时运行仍完成22原行程并重开一致，原归档不变。证据`evidence/SOCIETY_CANONICAL_RETAINED_HISTORY_2026-10-07.json`。初始测试空affinityTags被原规则拒绝，修正夹具为有效study标签，无改动不变量。

## 历史请求凭据接续

`canonical-request-history-v1` 保留原 authority operations（含指纹与结果）及各分区完整事件追加回执。FileEventStore 用原 codec 扫描全部回执并解析原事件，不受热缓存上限影响；损坏尾部拒绝。候选要求模拟、authority、revision、完整分区集合及 operations 与捕获来源一致。旧候选无此可选字段仍可读取，但不能作为已经完成去重迁移的正式切换结果。

新 journal 保留这些凭据并隔离其精确 operation/request/command ID。居民 invoke、时间推进、直接提交、副本接收和重开回放均不能复用历史 ID；不猜测新旧命令等价性，不把旧结果伪装成新 CLI 回执。新 journal 自己的同请求重试仍返回原结果。历史凭据为运行者资料，不注入居民上下文或新增居民工具；它们不产生新的资源效果。

真实冻结归档的临时组合候选保留 73 条 authority 回执、26 条分区追加回执、126 个唯一历史 ID。所有 ID 在重启前后均被拒绝，原 22 行程正常抵达，原档逐文件摘要不变。完整源绑定、旧 writer 退役和正式发布仍未完成；不能以这次临时运行替代最终激活。证据见 `evidence/SOCIETY_CANONICAL_REQUEST_HISTORY_2026-10-07.json`。

本轮质量门槛：全仓 lint、排序 typecheck、sim-core/worker build 通过；最终全仓 3254 tests passed / 1 skipped，493 files passed / 1 skipped。测试覆盖完整冷热回执、旧格式只读兼容、损坏尾部拒绝、来源集合绑定、居民请求/时间推进/副本拒绝、重启后新请求幂等；真实归档 126 个 ID 逐一验证。

## 旧源持久退役围栏

server 的 canonical runtime ownership 新增仅持有 archive 排他租约才能调用的 `retire` 端口。记录写在源树之外的同一 ownership 目录，绑定原源 realpath、源树 SHA-256、simulationId、目标规范路径与 manifest SHA-256；不修改原事件或认知文件。首次写入后 fsync 文件与目录，同绑定重试幂等，不同绑定拒绝。已释放租约、writer 租约、外部篡改的 ownership 记录、活动 writer、源目标重叠与非法摘要均拒绝。

正式 canonical CLI 原有 writer admission 见到 `retired.json` 即拒绝，包含损坏/部分写入标记；释放 archive 锁不撤销退役，不以 PID 或时间猜测恢复。已退役源仍可通过 archive 排他入口验证、导出或继续同一次迁移，不能被恢复成旧 writer。目标尚未发布或发布失败，也不得自动删除围栏回滚。

此端口只持久化运行者迁移编排提供的绑定，不自行验证目标 manifest 的领域完整性，也不激活目标。后续发布器必须先验证完整候选与源绑定，再持久退役，再原子发布目标，并支持中断后的同绑定恢复。当前还未实现该发布器，不能把退役端口视为完整切换。它仍依赖同文件系统上的协作式正式入口，不能拦截旧二进制、直接存储写入、复制到新路径的世界或任意跨主机 writer。

独立进程验收使用新建的受控目录：启动实际编译版 canonical daemon，运行中归档拒绝；SIGTERM 正常关闭后归档成功；排他端口持久退役后重新启动同一正式 CLI 拒绝；再次归档内容摘要不变，同绑定退役重试成功。目标使用明确的人造未发布摘要，只验证 admission 而非完整迁移。原有真实归档及运行目录未被本次退役。证据 `evidence/SOCIETY_CANONICAL_RETIREMENT_2026-10-07.json`。

退役围栏验收：43项相关测试通过；全仓3257通过/1原有跳过，493文件通过/1跳过；全仓lint、排序typecheck、server公开导出构建及格式检查通过。新增验证脚本最初未进入JavaScript lint范围，已沿既有脚本规则加入server/scripts范围，未放宽领域TypeScript规则。

## 可复用的归档来源读取器

server `readCanonicalSocietySource` 将之前工程脚本中的组合接续变成正式 application 端口。输入显式选择 simulationId、原 runManifestId、原策略配置和每个分区的实际 consumerId；不猜测“最新”manifest或未记录消费者。输出候选加来源绑定，包括完整归档摘要、原 runManifest 路径/ID、原代码 revision 和消费者映射。原 manifest 内容通过其原 canonical hash 工厂复算校验，scenario ID 与 authority 对齐，候选继续检查世界/认知/身份/去重和策略。

原快照 URI 仅用于计算相对归档原根的路径，必须命中已验证文件清单；绝不打开 URI 指向的活目录。快照参考必须逐字段匹配，checkpoint 尾部完整，事件连续并属于原模拟/分区；从 snapshot sequence 之后用原 world reducer 回放到事件尾，再进入 authority 屏障。存在未完成 event append transaction 则拒绝，不在迁移时猜测恢复。原文件和目录复制到本次独占临时目录后才打开旧仓储；读取完成再验证完整归档，finally 删除本次临时副本，源归档始终只读。

认知来源必须存在，不能借仓储构造器补造丢失文件；原来源无记录与文件缺失严格区分。当前读取原场景可识别的当前居民，完整事件流和有快照的 checkpoint；已裁剪事件、后加入/退出主体、新旧自定义策略、缺失原文件等尚须明确迁移端口，不能静默丢弃后激活。源原代码 revision 是保留证据，不声称它与当前运行代码逐字一致。来源选择和候选验证仍不等于源退役、目标发布或完整R01。

真实归档读取得到的候选 SHA-256 为 `a3c9d90ddf0debfc04e835c7866d241588e03d8fa26d1aebf8c8dff4fe3e8c40`，与既有历史请求迁移候选完全相同。25居民、126历史ID、22原行程在临时runtime中验证，重开回放一致。首次实际验证发现旧event envelope的partitionKey可缺省；按原事件流路径确定来源，仅显式分区冲突拒绝，未给旧事件补字段或改写事件。测试同时覆盖缺省字段的旧事件尾部回放。证据 `evidence/SOCIETY_CANONICAL_SOURCE_READER_2026-10-07.json`。

来源读取器质量门槛：4项新增测试通过，全仓3261通过/1原有跳过、494文件通过/1跳过，最终全仓lint、排序typecheck及server构建通过。保留首次旧event分区缺省误拒绝与JSON类型lint错误的原因及修复记录，不把临时候选运行宣称为正式切换。

## 正式迁移发布器与运行者 CLI

`server.publishCanonicalSocietyCutover` 串联来源读取、排他ownership、退役与发布。正式入口：

```sh
node apps/server/dist/localRuntimeTownCliMain.js migrate-society \
  --archive /absolute/source-archive --target /absolute/new-society \
  --simulation SIMULATION_ID --run-manifest RESOLVED_RUN_MANIFEST_ID \
  --source-options /absolute/source-options.json --confirm-source-stopped
```

source-options 包含显式 `policyConfiguration` 与 `consumerIds`（partitionKey 到原 consumerId）。停机声明用于未接协作围栏的旧/外部writer，不代替本地排他锁。发布器持有源archive租约，完整核对当前源树与归档（含未知文件），拒绝将同一根目录内的其他simulation悄悄留在已退役旧端；多世界源须另行完整编排。目标与源/归档不能重叠，不覆盖既存非迁移目录。

候选在同级私有临时目录打开实际Runtime，必须零提交且初始world与候选相同，再写入migration.json绑定源摘要、原manifest/revision/消费者、目标路径及目标manifest实际字节摘要。文件/目录fsync、再次复核源树后，先持久退役原源，再rename原子发布目标并fsync父目录。此时目标可被既有resident-society入口读取，不调用旧planner、不播种新资产或隐式开启新领域策略。

同绑定重试核对既有目标migration记录与初始manifest，不改写目标日志，保留已发生的新事实。退役后rename失败时旧源仍封闭，后续可重新从相同归档构造相同候选继续发布；改绑其他目标拒绝。临时目录只在本调用拥有且未发布时清理；旧源、归档、他人目标不删除。当前验证的是有序异常恢复，SIGKILL遗留ownership/gate/目标锁的显式恢复、旧二进制或跨主机writer仍需后续，不声称自动恢复。

这发布原世界基础接续，并非完整社会profile已全部启用。新生活规则、退出/后来主体来源、所有旧接口/界面、完整分区接入与长期自由运行仍属于原25项总目标，后续不得以这个初始manifest替代它们。

正式CLI实跑验收：新建隔离canonical daemon正常关闭后导出，migrate-society发布成功；新端完成22段原行程，重复发布保留新日志，重开回放一致；旧CLI启动拒绝，原归档摘要不变。7项读取/发布相关测试通过（含退役后rename故障、同绑定恢复和改绑拒绝）；全仓3264通过/1原有跳过、494文件通过/1跳过，lint、排序typecheck、server构建与格式检查通过。

在该隔离迁移目标上，正式resident-society入口调用真实OpenCode完成1次无剧情机会、21次调用，正常退出。journal记录1次求职申请、1次真实出行开始及活动预留、2条短期记忆、1次时间推进；模型未完成出行不能冒充已抵达。重开无新增提交，再次迁移发布保留模型全部事实。实际有1次unknown-rule-section及3次materials-not-enabled拒绝，明确保留为能力发现/显式启用缺口。这是迁移后可用性验收，不是持续涌现证据。证据 `evidence/SOCIETY_CANONICAL_CUTOVER_2026-10-07.json`。

## 迁移后的显式基础社会启用

`activateSocietyFoundations` 是worker应用编排，运行者入口 `node apps/residents/dist/cli.js enable-society-foundations --root DIR`。固定 `society-foundations-activation-v1` 顺序调用现有版本化端口：life、kernel、record-views、collectives、common-accounts、resource-control、group-control、materials、premises。各步仍由原领域事件/journal原子提交，拒绝立即停止，已提交前缀不回滚；重试依据真实状态继续，不重复创建事件。未有持久turn.finished回执的居民轮次阻止启用，不能仅凭保留的最近轮次ID判断仍在运行。

这只启用空聚合及行动规则，不调用场景工厂，不增加组织、会员、契约、材料、车辆、土地、资金或身体参与，不设置完整integrated profile标签。manifest及canonical原策略来源保持不变，变化以明确启用事件记录。原有服务v1不能直接当成有真实提供者的服务v3；身体时间/旧预付活动、来源明确的有限原料与设施、mobility/continuity和完整profile剩余模块继续后续迁移，不删减总范围。

实际迁移目标从revision25到34完成9次启用，原居民、余额/国库、时钟与在途状态相同，stock/site均为空；重复CLI执行无新提交，重开回放一致。材料保管目录可用，有限原料目录仍明确未启用。这里没有再次运行模型或声称涌现。证据 `evidence/SOCIETY_CANONICAL_FOUNDATIONS_2026-10-07.json`。

基础启用质量门槛：6项相关测试通过（含2项新启用测试），全仓3266通过/1原跳过、495文件通过/1跳过；lint、排序typecheck、worker/residents构建及格式/diff检查通过。

## 旧服务协议到真实提供者目录的显式过渡

services 领域新增 `resident-service-policy-transition-v1` 与 `ServicePolicyUpgraded`。v1/v2必须先按原协议关闭供给并处理完requested/accepted/checked-in预约、waiting队列及未结束提供者时间；拒绝时不变更任何记录。升级事件携带原policy、新v3 policy、模拟时间和退役旧服务ID集合，保留原容量/文本上限及全部原service/slot/booking/queue记录。原completed/ended状态不互相转换，不补造参加时长、提供者或同意。旧关闭供给留作历史，普通/主体reopen不能复活旧协议；需要新服务声明后才能使用v3规则。

运行者可调用 `upgrade-service-providers --root DIR` 单独升级，或 `enable-society-services --root DIR` 按固定版本阶段调用升级、service-control、service-principals、service-supply、service-affiliations、service-relations。每步复用原领域与world端口，失败停止、重试保留已提交前缀。未结束居民轮次阻止升级；已完成轮次的结束回执是依据，不能仅看残留activeTurnId。

当前服务多主体端口依赖既有公共授权注册，阶段入口缺失publicGovernance时明确拒绝，不在服务操作中隐式创建政府。隔离迁移世界先单独显式调用现有 `enable-public-governance`，再运行服务阶段；这是运行者声明的初始公共授权扩展，不是居民投票或自主制度涌现。私人服务登记对公共注册的这项耦合仍需边界审视，不能视为最终架构；本轮没有通过放宽旧事件校验绕过它。

真实迁移目标revision34到41记录上述一次公共授权启用及六项服务阶段提交。原manifest、居民/资金、时钟、在途和身体时间相同，没有新服务、provider、slot或booking。重复阶段不增加提交，重开回放一致。真实身体服务效果/设施、完整profile及跨运行模式仍继续。证据 `evidence/SOCIETY_CANONICAL_SERVICE_TRANSITION_2026-10-07.json`。

服务协议过渡最终验收：全仓 3270 项测试通过、1 项跳过（496 个文件通过、1 个跳过）；lint、全仓 typecheck、相关 build 和格式检查通过。证据见 `evidence/SOCIETY_CANONICAL_SERVICE_TRANSITION_2026-10-07.json`。该结果仅覆盖本阶段，不代表完整社会能力或自然涌现已经完成。

## 服务授权与公共治理分离（显式 v2 阶段）

边界修正：服务目录是可供个人、企业、集体或公共主体使用的通用能力；公共治理只能授权公共主体，不能成为其他主体开办服务的先决条件。原先 world 激活和 Runtime 重开把目录存在与公共 grant 存在强制等同，重复了 `resourcePrincipalAuthority` 已有的逐主体授权。

新增 services `resident-service-principals-v3`，保留相同控制原语和容量上限。新目录用该明确 policy 启用；已有 v2 目录通过 `ServicePrincipalAuthoritySeparated` 携带前后版本过渡，保留全部服务、预约、同意、公共 grant 和未结义务。旧 policy/event 继续使用原校验分支，不静默重解释。world 的 v3 集成包记录对应 policyVersion；供给、关联和关系端口依据目录中已经持久化的 v3 移除无关公共前提，身份、控制来源、真实场地、容量、企业授权和公共提案证明仍独立核验。公共审批存在也不自动扩张其范围。

新运行者入口：`node apps/residents/dist/cli.js enable-independent-society-services --root DIR`，固定 `society-services-activation-v2`。复用六步编排，当前个人轮次必须结束，各步原子且可重试；不会创建政府、公共授权、服务提供者或设施。旧 `enable-society-services` v1 保留原行为。迁移 manifest 不重写，政策通过 journal 中显式过渡持久化；新旧世界均由同一 Runtime 重开读取。

交付：`town rules services` 按需显示 principalPolicy、publicServiceAuthority、publicCreationAuthority；居民继续使用已有服务/主体 CLI，不增加居民动作数量，不把额外目录注入常态上下文。本阶段不是跨领域全部主体权限解耦：其他资源模块的类似前提仍须按真实调用路径检查，不能据此声称全运行模式已经完成。

独立服务授权验收：隔离迁移世界revision41→42，仅新增显式策略过渡，world（含公共授权）和服务约定不变；重复CLI不新增提交，重开一致。全仓3274通过/1跳过、496文件通过/1跳过；lint、typecheck、相关build和格式检查通过。随后真实OpenCode无剧情运行1次机会、5次调用，记录出行开始、身体时间预留、短期记忆和时间推进；有限原料查询拒绝 `finite-material-sources-not-enabled`，没有服务采用或抵达证据。journal到50次提交，重开不改日志。证据 `evidence/SOCIETY_INDEPENDENT_SERVICE_AUTHORITY_2026-10-07.json`。

独立启用的目录不自动获得公共grant；之后接入公共服务采购还需要单独、显式的公共授权注册路径。本阶段保留并验证已有公共授权，不声称已完成该新增路径或其他资源模块的权限解耦。

## 真实睡眠/学习与显式原料新增声明

迁移目标的策略预检发现：来源已使用版本化随机疾病cadence，原有在途活动是到达结算，不是预付身体效果，可以通过已有world端口显式启用实际睡眠与学习。`enable-society-body-learning --root DIR` 使用 `society-body-learning-activation-v1`，按rest→study启用，不修改原policy continuation或旧活动，不产生即时恢复/知识、人员或工资。未结束居民轮次阻止阶段启用；领域仍拒绝未结束的预付活动。真实劳动工资依赖明确的laborPay条款，原canonical来源只有wageCalculator，不能擅自转成时薪，此项仍待显式迁移。

原料领域保留 `resident-extraction-v1` 的有限数量、真实劳动和无自动再生约束；新增可选 `declared-material-endowment-v1` origin，属于materials的供给来源事实。旧事件和快照没有origin时保持缺省，不能补造来源。新声明明确kind为 `new-operator-endowment`，不是历史产权、居民劳动成果或发现了旧存量。原料在开始劳动前仍不是个人可用库存。

运行者入口 `enable-physical-production --root DIR --material-endowment JSON_FILE`。文件严格包含 `{origin,sources}`；origin包括version、id、kind、description，sources逐个声明id、locationId、commodity、initialQuantity、workMs、energyCost、satietyCost、capacity。领域验证数量、地点、容量及旧再生池互斥，world原子提交来源与初始数量。canonical迁移世界未启用时必须提供声明，禁止调用默认场景播种；新场景旧入口行为保留。原manifest不重写，声明随事件回放。重复同一声明不新增事件或补满已采数量；不同声明拒绝，未完成居民轮次拒绝新启用。

`town sources list/read` 主动返回origin，未声明的旧来源返回null，不把来源说明自动注入常态上下文。居民仍用已有采集/劳动/库存命令，不增加工具或规定生产组织。

实际验收：隔离迁移世界revision50→53启用实际睡眠/学习及明确新增8种各100单位原料；原资金、身体、库存、时钟与在途活动未变。缺少来源声明的首次canonical启用明确拒绝，重复声明和阶段无新增提交，manifest不变，重开回放一致。全仓3277通过/1跳过、496文件通过/1跳过；lint、全仓typecheck、相关build及格式检查通过。

随后真实OpenCode无剧情完成1次机会、17次调用，sources.list成功且返回声明原文；模型自主开始出行、等待。日志无实际采集/生产/睡眠/学习，不能声称效果已被模型采用。唯一拒绝为resident-labor-not-enabled，继续指向计价周期与真实劳动迁移。journal到73次提交，重开不改日志。证据 `evidence/SOCIETY_CANONICAL_BODY_MATERIALS_2026-10-07.json`。


## 企业双方计价的显式启用

`enable-agreed-labor` 从无实际劳动状态启用既有身体劳动规则与显式双方计价来源；无需给原canonical补造全局时薪。隔离世界revision73→74，原manifest、居民资产/身体/位置/时钟和物品不变，无报价或同意被生成。重复启用不新增提交，回放一致。居民企业的报价/本人接受/真实工作已有定向编译HTTP/CLI验收，11次调用包含3次预期越权拒绝；实际五分钟劳动累计5元，资金守恒。模型是否采用另行记录。初始非企业岗位工资制度与旧实际劳动模式升级尚待独立实现。


启用后无剧情OpenCode一次机会执行35次调用，无工具拒绝；记录求职、个人认知、创建库存/预留采集/本人开工。179495ms时达到配置的180000ms预算，由TimeoutError触发SIGTERM，无provider error事件；该轮为provider-error而非完成。没有时间推进/可用产物/劳动报价接受。journal到111，重开回放一致且不新增提交、写锁释放。全仓3286通过/1跳过；证据 `evidence/SOCIETY_AGREED_LABOR_INTEGRATION_2026-10-07.json`，不能将此次动作组合称作稳定涌现。


## 真实服务与生产计薪接入阶段

`enable-society-livelihoods --root DIR` 使用 `society-livelihoods-activation-v1` 依次调用既有service-engagements、service-time、service-employment、productive-employment端口。领域、聚合、结算与启用不变量保持原归属，阶段只是worker应用编排；每步原子且可回放，拒绝停止并报告已完成前缀。现有服务/生产会话、预付义务与工资策略前提仍由原领域验证；阶段不隐式启用身体、工资、材料或公共制度。

不新增居民工具，不生成设施、雇员、提供者、协议或工资。原manifest保留，已有availability与主动CLI查询反映当前实际状态；不能把目录服务存在解释为真实医教设施齐备。

隔离迁移世界首次执行：revision111→114启用三个服务步骤，因居民既有采集会话而正确拒绝生产计薪。通过既有simulation-time端口从2731000推进至已承诺结束时间3331000（600000ms），保留实际劳动和产物；随后重试到revision116完成生产计薪。启用本身未改居民/资金/物品/时间/公共授权。重复调用无新增提交，重开回放相同。时间推进是运行者结算既有承诺，不是模型新选择。

定向编译HTTP/CLI验收通过显式阶段后走实际服务/公司授权/本人接受/部分时间/收费/欠薪/再入资支付，服务收入与个人工资分离。真实模型自由运行另行记录。完整设施、初始非企业岗位与所有原运行模式仍按原25项继续。


本阶段工程验收：全仓3288通过/1跳过、498文件通过/1跳过；lint、全仓typecheck、worker/residents build、格式检查通过。阶段测试8项；真实CLI服务链26次调用含7次预期拒绝。此前已由模型开工的采集在原定600000ms劳动结束时产生10单位Wood，既有采集来源与身体效果按原world事件结算。证据 `evidence/SOCIETY_CANONICAL_LIVELIHOODS_2026-10-07.json`。


随后无剧情OpenCode完成一次机会：19次调用、exit0、124089ms，无工具拒绝。自主创建库存/预留采集/本人开工并等待，记录实际production-progress与SimulationTimeAdvanced。journal到138，重开回放一致、无新增提交且写入者已释放。未出现service engagement或企业劳动报价接受；这是基础生产元能力的自主使用，不是稳定组织或服务涌现。


## 有限建设来源与物理交付接入

实际发现并修复运行者 `enable-premises-rights` 只有handler、缺少命令白名单/帮助的入口断点；正常编译CLI此前返回unknown-command。现在能够发现并调用，缺少premises返回失败exit1，成功、重试、回放均有真实进程验证。未新增居民工具或改变许可领域语义。

隔离世界通过已有 `register-construction-site` 登记一个明确新增初始地块：id=declared-workshop-construction-site，parentLocationId=workshop，usableFloorArea=200，accessTravelMs=60000，sourceId=new-operator-land-endowment-20261007。这是一份显式运行者资源声明，来源为authorized-extension，不是迁移原世界土地或历史居民产权；占用/预留初始均为0，未生成建筑或医教位。来源保存在事件/按需site查询，采用现有public-construction-use-v1初始制度，不宣称居民已经投票同意。

随后直接复用既有CLI启用premises-rights、logistics与evidence-trade-v2有偿许可，revision138→142。旧货物、正在进行的采集、身体/资金/时间、公共授权与车辆状态不变；不播种车辆，不将地块算作室内库存/服务设施。原manifest不改，重复四个命令无新增提交，重开回放一致。居民可自行选择蓝图、供料、本人施工与建成后许可/交付；本次运行者操作不替居民执行这些选择。

现有设施容量规则已启用；旧场景地点继续按旧语义，新建建筑受真实容量/设施约束。旧地点到完整实体建筑的来源迁移仍未完成，不能称为所有场所均已物理化。无剧情模型观察与定向许可/付款测试分开记录。


工程验收：`pnpm --filter @aivilization/residents verify:premises-rights-activation` 验证真实编译CLI的帮助/前提拒绝exit1/启用/重试/回放；既有verify-premises-rights与verify-paid-permits真实CLI链通过。全仓3288通过/1跳过、498文件通过/1跳过，lint、全仓typecheck、residents build与格式检查通过。证据 `evidence/SOCIETY_CANONICAL_PHYSICAL_EXCHANGE_2026-10-07.json`。


无剧情OpenCode完成一次机会，16次调用、exit0、无拒绝；自行创建库存/采集任务/开工并等待，保留实际生产进度。未采用建设、空间许可、货运合同或付费许可，不据此声称新机构已经形成。完整journal重开一致，无新增提交且写入者已释放；详细事件计数见本阶段证据。


## 显式新增护理/教学设施

旧归档中的clinic/school只有用途与人数容量，没有护理/教学位及历史建筑来源。新增 `register-service-facilities` 运行者入口接受精确有限声明，在服务已启用后以独立ResidentServiceFacilitiesRegistered事件原子登记；不倒推历史。原premises域继续拥有设施唯一性/数量/来源，world与旧初始化共同使用真实地点容量检查。已存在设施不可覆盖，未结束居民轮次不能插入；同声明重试不添置第二批。

隔离世界revision161→162显式新增clinic护理位2、school教学位2，sourceId=new-operator-service-facilities-20261007，source=authorized-extension。原manifest、居民、身体、财产、时间、材料、工作与服务约定保持原值。没有教师、照护人员、服务机构或居民同意被创建。居民可通过既有设施查询发现来源，再自行选择是否开展服务；不能把本次登记称为恢复了旧设施或已完成完整医学模型。

详细边界与验收要求见 `SOCIETY_SERVICE_FACILITY_REGISTRATION_V1.md`。真实编译CLI验证超容量批失败不改世界、明确登记与重试，并在新增护理位上完成本人同意/参与后的实际照护与收费，健康随实际重叠时间变化。无剧情模型采用另行记录。


设施阶段最终验收：全仓3291通过/1跳过，499文件通过/1跳过，lint/typecheck/build/格式检查通过。随后无剧情OpenCode完成31次调用、exit0、无工具拒绝；自主查询建设地块/记忆并进行采集、实际劳动与等待，没有护理/教学服务约定。journal到196，重开回放一致且未新增提交，写入者释放。证据 `evidence/SOCIETY_DECLARED_SERVICE_FACILITIES_2026-10-07.json`；不以基础设施存在或定向照护成功冒充机构涌现。


## 资源主体、空间合同与工程交易接入

本阶段先纠正一个临时审计误报：enable-resource-sales-v2本来就在CLI白名单与帮助中，漏报来自扫描未包含数字。项目入口无需修改。真实编译命令的失败是缺少车辆principal适配，而不是unknown-command。

隔离世界复用六个已有显式运行者入口：resource-principals、premises-principals、principal-permits、principal-trade、construction-trade、resource-sales v1。revision196→202，原manifest不变；居民、资金、现有物品/生产/占地、既有许可和约定不改。公共grant增加相应可授权资源/建设/许可/交易范围，原治理程序、居民决定与表决不变；这是明确的运行者初始制度扩展，不是居民已经批准某个采购。所有后续公共/集体动作仍须精确授权与原子消费。

重复启用无新增提交，重启回放一致；再调用resource-sales-v2真实返回invalid-resource-sales-activation，日志不变。未添加车辆来满足这个无关库存定价的前提。现有v1建筑买卖可用，v2库存/车辆定价仍未启用，不能宣称全部资源交易完成。

已有compiled CLI验证资源主体41次调用、建筑买卖20次调用、工程订单13次调用，分别包含7/4/2次预期拒绝；对应集成测试19项通过。定向验证与真实自由采用分开取证，未创建企业/社团或替居民转移资产。

后续真正的边界问题是：私人资源能力的启用被全局公共grant和不相关的车辆领域绑定。应通过明确、兼容的适配协议把能力可用性与公共授权、具体资源来源分开；保留旧协议行为，不删除真实权属/义务/付款验证。该分离尚未实现，保持在完整交付范围。


随后真实OpenCode完成24次调用（exit0），出现两次production-workstation-unavailable与一次material-stock-revision-conflict。核对唯一原料源与实际会话：declared-wood的两个劳动位已被居民006/007占用，居民008的同源任务尚未开工；不是缺少室内工位。模型主动查询construction.plan，但未形成建筑/资产交易/集体采购。保留失败及原容量，没有增加车辆或放宽约束。新证据说明拒绝名称混淆了原料源与工位，可解释性需补；整体交易权限解耦仍未实现。证据 `evidence/SOCIETY_CANONICAL_ORGANIZED_RESOURCES_2026-10-07.json`。

### 2026-10-07 独立资源接入

隔离迁移世界247→248，显式启用independent-resource-adapters-v1，保留原stock/premises主体接入并扩展报价策略到resource-sales-v2。全部其他world字段、已有报价、公共grant和manifest字节不变；无车辆域且未播种车辆。真实管理CLI重试不追加，重新打开回放一致。验证器：`apps/server/scripts/verify-canonical-independent-resources.mjs`；机器证据：`.local/canonical-cutover-20261007/independent-resources-verification.json`。这只使既有私人库存/建筑交易不再依赖无关车辆与公共前提，不表示居民已经采用交易或公共权限获得扩张。


## 原制度与自主选择的显式接入（741→744）

完整24机会观察分成含超时的13次与成功11次，两段回放/历史前缀一致，终点741。此后741→742开启`independent-periodic-access-v1`：原金融协议不变，私人能力不要求公共grant且不扩张公权。742→743单独开启公共就业修改范围，逐项验证继承canonical招聘条款/周期/source，不重试申请或直接录用。743→744只打开六个原有住房服务等级的查询/本人选择，现有等级/住所/欠费/身体/权限不变。三步均只经原公开运行者CLI，原manifest与非目标状态保留，幂等/回放通过。

证据分别见INDEPENDENT_PERIODIC_ACCESS、CANONICAL_PUBLIC_EMPLOYMENT与CANONICAL_HOUSING_CHOICE。这些是该canonical来源世界的能力接入，不是所有canonical/分区/多机完成；没有把自然运行中缺少工具误算为居民同意，也不以工程迁移宣称社会采用。

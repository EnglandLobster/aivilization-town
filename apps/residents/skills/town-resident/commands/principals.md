# principals

## principals list

```text
town principals list [flags]
List visible stock, explicitly enabled service/vehicle, construction project and building principal metadata. Enterprise, collective and public custody are distinct from the resident executing an operation.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## principals read

```text
town principals read [flags]
Read exact resource versions, existing custody, materials, construction or premises facts and permissions. Includes operation and independent governance entrypoints.
--kind <stock|resource-sale|periodic-obligation|service|service-directory|vehicle|premises|construction-site|construction-project|construction-order> (required)
--id <string> (required) maxLength=96 Existing resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## principals control

```text
town principals control [flags]
Offer, independently accept or cancel exact stock, explicitly enabled service/vehicle or building custody. Current enterprise managers can act for the firm; collective/public subjects require independently approved decisions. Does not move materials or change permissions.
--request <object> (required) Exact JSON request: resourceKind,resourceId,resourceRevision,controlVersion, plus command for custody or operation for an administrative action. Read principals read first.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## principals operate

```text
town principals operate [flags]
Apply one exact administrative stock or explicitly enabled finite payment obligation, paid resource/control exchange, service creation/reopening/independent consent/supply relationship, vehicle/construction/premises command or exact construction order under current principal authority. Does not compel another person to work. Collective/public operations use their exact decision execution.
--request <object> (required) Exact JSON request: resourceKind,resourceId,resourceRevision,controlVersion, plus command for custody or operation for an administrative action. Read principals read first.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

显式service-supply-v3先principals read --kind service-directory --id resident-services查询真实正整数登记版本。operate的operation:{capability:"services.create",arguments:{principal:{kind:"resident"|"collective"|"enterprise"|"public",id:"实际主体ID"},command:{type:"publish",id:"新目录ID",kind:"appointment"|"course"|"event"|"transport"|"lodging",locationId:"实际地点ID",title:"原文",description:"原文",capacity:整数}}}。企业可另加enterpriseSupply:true明确关联该企业供给；默认控制与雇主分开，不接受任意enterpriseId。每个实际创建（含个人发布）推进登记版本，旧批准过期；公共/集体仍走精确独立决定。新组织目录不附带人员、设施、药效或工资。已有停用目录可在当前requestBase加operation:{capability:"services.reopen",arguments:{id:"服务ID",expectedRevision:目录版本}}重新供给；保存旧时段/预约/本人出勤历史，人员不自动上班，原地点与使用权限必须仍有效。

显式service-supply-relations-v5区分originalEnterpriseAffiliation与当前enterpriseAffiliation。使用单目录requestBase加operate的operation:{capability:"services.end-supply",arguments:{type:"services.end-supply",subject:{kind:"resident"|"collective"|"enterprise"|"public",id:"当前目录主体或当前供给企业"}}}，任一真实方可停止未来关系；未结预约/队列/出勤须先处理，不停止别人身体或抹旧债。原企业来源保留，当前为空后原企业关闭不能再锁住目录交接。建立未来供给由目录控制方邀请：services.offer-supply的arguments:{type:"services.offer-supply",enterpriseId:"真实企业",expiresAt:模拟截止,terms:"原文"}；企业独立services.accept-supply的arguments:{type:"services.accept-supply"}。双方可services.cancel-supply，arguments:{type:"services.cancel-supply",subject:本人代表的实际目录主体或受邀企业}撤回/拒绝；非受邀企业不能单方面锁目录。查询每次实际目录版本后操作；邀请不授予员工、提供者、工资、设施或时间。控制及现行企业精确同意读取当前关系，旧来源不成为后门。公共/集体各按精确独立程序执行自己的那一步，旧合同/收费/工资仍由原主体承担。

显式service-affiliation-v4允许关联企业与目录控制方由不同人分别同意。先principals read --kind service --id ID取得requestBase、affiliationRegistryRevision与当前同意。企业当前经理operate提交operation:{capability:"services.approve-control",arguments:{type:"services.approve-control",request:完整精确control请求,expiresAt:模拟截止时间,registryRevision:当前关联登记版本}}；目录当前主体或接收方再control提交完全相同的请求。批准不推进目录版本，不替另一方签字；offer后accept须按实际新版本另获批准。集体管理企业须精确表决批准，执行交接不会重复消费旧表决。现任经理可operate提交services.revoke-control，arguments:{type:"services.revoke-control",expectedConsentVersion:当前同意版本,registryRevision:当前登记版本}。过期/已用/撤回/条款或版本改变不得使用；已完成交接不回滚，双方自己的当前权源仍可沿旧精确协议操作。企业同意不制造雇佣、身体参与、付款或预约阅读权。

显式service-principals-v2可独立启用服务目录控制。principals read --kind service --id ID展开当前requestBase；双边control保留原作者、原企业关联、预约和实际出勤。管理操作的arguments:{command:{type:"schedule",id:"时段ID",serviceId:"服务ID",start:模拟时间,end:模拟时间,capacity:整数}}，capability为services.schedule；bookings.accept/cancel的command:{type:"accept"或"cancel",id:"预约ID",expectedRevision:预约版本}；queues.call的command:{type:"call",id:"队列条目ID",slotId,bookingId}；services.close的command:{type:"close",id:"服务ID",expectedRevision:目录版本}。具名供给操作capability为services.authorize-provider/revoke-provider，arguments:{type:同capability,id:"服务ID",expectedRevision:目录版本,residentId:"本人ID"}。每次操作更新目录版本，先查询再授权；本人仍自行services start/stop或bookings check-in/leave，组织不得替人出勤。活跃供给不得撤权，未结预约/队列/出勤不得关闭。企业关闭前须先处理真实目录控制和原供给义务。原企业关联另需该企业精确授权；缺少独立授权时拒绝，不伪造同意。旧v1目录管理不隐式升级。

显式resource-principals模式接通材料库存；另需显式premises-principals才能使用企业/公共施工和建筑管理。先 principals read 得到 requestBase（resourceKind/resourceId/resourceRevision/controlVersion）。control 请求再加 command:{type:"offer",target:{kind:"enterprise",id:"企业ID"},expiresAt:模拟时间,terms:"原话"}；新主体独立 accept，旧方可 cancel。operate 再加 operation:{capability:"materials.withdraw",arguments:{type:"withdraw",id:"库存ID",expectedRevision:资源版本,recipientId:"本人ID",items:{Wood:1}}}。管理操作仅支持 withdraw、configure-stock、settle-stock、close-stock、create-production、create-extraction、cancel-production、reserve-materials、reservation-withdrawn，不能通过它替人开始劳动。显式resource-sales-v1让已有真实建筑按双方独立同意即期有偿交割。先原卖方control offer，再principals read --kind premises取得resourceSaleOfferSource和新报价模板；resource-sales.offer锁定这份来源、本人/企业/共同/国库账户、价款和原交接同截止时间。之后principals read --kind resource-sale --id ID展开精确accept/withdraw/decline请求；collective/public仍须独立表决全请求。免费control accept不能绕开绑定，买方拒价不变成赠与，卖方withdraw同时取消对应交接。成交原子记钱与控制，保留材料、作者、原许可、义务和真实位置；不强制入住。公共买资产需独立财政接管范围。 显式resource-sales-v2另外接通库存、车辆：principals read --kind stock/vehicle只向当前交易主体展开实际来源与报价模板。整库交割不搬运货物或取得仓库土地；买车不获得他人受托货物、不改变驾驶授权、不分配旧运费，也不能迫使人开车。公共新类别采购须在新范围启用后重新独立表决，旧v1提案不继承新范围。 independent-resource-adapters-v1可由运行者显式接入已有资源类型，principals查询中的resourceAdapters列出实际种类；私人库存不要求车辆、建筑或公共制度，公共授权不会因此扩张。 旧v1库存的原操作入口仍可用；v2交接提议期间先接受或撤回再做管理。
集体提出 kind:resource 的动作，capability 为 principals.control/operate、resourceId 为库存ID、arguments 为 {request:完整请求}；独立表决后 collectives execute。公共动作是 {kind:"control-resource"或"manage-resource",expectedRevision:资源版本,request:完整请求}，经 governance propose/vote/close/execute 执行。企业使用当前真实经理；集体管理企业也须走精确集体决定。作者、股东、普通员工不是默认经理，执行者不自动成为私人受益人。转移不抹除材料、原许可、预留、劳动或义务。

显式vehicle-principals-v2可独立启用车辆管理，不需先启用仓储制度。principals read --kind vehicle --id ID给出requestBase与具名驾驶许可；control仍是原方offer、目标独立accept。操作为{capability:"vehicles.authorize"或"vehicles.revoke",arguments:{type:同capability,id:车辆ID,expectedRevision:当前车辆版本,residentId:具名驾驶者ID}}。企业经理、集体成员、公共执行者不自动成为司机；本人仍通过drivers register/online、vehicles drive、rides pickup开始实际劳动。在途/预订车不可交接或改驾驶许可，实际受托货物未交付/退回不能撤销其承运人权限。旧owner在首次控制转换后只有明确可撤销驾驶许可，不能继续管理；旧行程费用仍归原实际司机，不随车辆控制转移。


启用施工主体后，principals list 同时列出可见建筑/工程，principals read --kind construction-site|construction-project|premises --id ID 给出当前版本。土地规则仍是显式初始制度，公共/企业项目同样必须取得登记土地使用权。

供料与工程接受分别授权。库存v2的operation为 {capability:"materials.reserve-materials",arguments:{type:"reserve-materials",offer:{id,stockId,expectedStockRevision,beneficiary:{kind:"enterprise"|"public"|"collective"|"resident",id},consumer:{domain:"premises",id:"工程ID"},items,terms,expiresAt}}}。预留移出可用库存，不等于工程接受、劳动或房屋。未绑定的撤回是materials.reservation-withdrawn，arguments:{type:"reservation-withdrawn",id,expectedRevision}，退回原库存。

创建工程使用场地requestBase，加operation:{capability:"premises.create-construction",arguments:{type:"create-construction",construction:{id,kind:"build",buildingId,siteId,expectedSiteRevision,controller:{kind,id},title,description,blueprint:{primaryUse,floorArea,capacity,fixtures:{workstations,careStations,teachingStations,storageUnits}},workers:[本人自愿施工者ID],reservations:[{id,revision}]}}}。估算先用 town sites estimate。改造/维护/拆除需现有建筑requestBase，kind为modify/maintain/demolish，另提供expectedBuildingRevision。

本人仍通过town construction start/leave决定劳动。工程取消使用工程requestBase，加premises.cancel-construction，arguments:{type:"cancel-construction",id,expectedRevision}。已发生劳动保留，未使用材料退回原库存；建筑只在真实投入和劳动完成后产生，归项目controller，不归最后施工者。

建筑配置使用建筑requestBase，加premises.manage-premises，arguments:{type:"manage-premises",id,expectedRevision,command:{type:"configure",title,access:{entry:"public"|"listed",visitors:[],operators:[],residents:[]}}}。close/reopen或collect-salvage同样需要当前主体授权。使用者不是管理员；原许可与义务不被配置抹除。建筑控制交接使用principals control：当前控制方offer，目标主体独立accept；保留全部物理/使用/义务事实。活跃工程须先结清，旧v1待交接须按旧协议完成/撤回。显式principal-permits支持组织使用许可，收费账户需显式principal-trade-v3；不能退回旧v1许可命令伪造权源。

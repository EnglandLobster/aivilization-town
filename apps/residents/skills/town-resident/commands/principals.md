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

显式resource-principals模式接通材料库存；另需显式premises-principals才能使用企业/公共施工和建筑管理。先 principals read 得到 requestBase（resourceKind/resourceId/resourceRevision/controlVersion）。control 请求再加 command:{type:"offer",target:{kind:"enterprise",id:"企业ID"},expiresAt:模拟时间,terms:"原话"}；新主体独立 accept，旧方可 cancel。operate 再加 operation:{capability:"materials.withdraw",arguments:{type:"withdraw",id:"库存ID",expectedRevision:资源版本,recipientId:"本人ID",items:{Wood:1}}}。管理操作仅支持 withdraw、configure-stock、settle-stock、close-stock、create-production、create-extraction、cancel-production、reserve-materials、reservation-withdrawn，不能通过它替人开始劳动。库存交接提议期间，先接受或撤回再做管理。
集体提出 kind:resource 的动作，capability 为 principals.control/operate、resourceId 为库存ID、arguments 为 {request:完整请求}；独立表决后 collectives execute。公共动作是 {kind:"control-resource"或"manage-resource",expectedRevision:资源版本,request:完整请求}，经 governance propose/vote/close/execute 执行。企业使用当前真实经理；集体管理企业也须走精确集体决定。作者、股东、普通员工不是默认经理，执行者不自动成为私人受益人。转移不抹除材料、原许可、预留、劳动或义务。


启用施工主体后，principals list 同时列出可见建筑/工程，principals read --kind construction-site|construction-project|premises --id ID 给出当前版本。土地规则仍是显式初始制度，公共/企业项目同样必须取得登记土地使用权。

供料与工程接受分别授权。库存v2的operation为 {capability:"materials.reserve-materials",arguments:{type:"reserve-materials",offer:{id,stockId,expectedStockRevision,beneficiary:{kind:"enterprise"|"public"|"collective"|"resident",id},consumer:{domain:"premises",id:"工程ID"},items,terms,expiresAt}}}。预留移出可用库存，不等于工程接受、劳动或房屋。未绑定的撤回是materials.reservation-withdrawn，arguments:{type:"reservation-withdrawn",id,expectedRevision}，退回原库存。

创建工程使用场地requestBase，加operation:{capability:"premises.create-construction",arguments:{type:"create-construction",construction:{id,kind:"build",buildingId,siteId,expectedSiteRevision,controller:{kind,id},title,description,blueprint:{primaryUse,floorArea,capacity,fixtures:{workstations,careStations,teachingStations,storageUnits}},workers:[本人自愿施工者ID],reservations:[{id,revision}]}}}。估算先用 town sites estimate。改造/维护/拆除需现有建筑requestBase，kind为modify/maintain/demolish，另提供expectedBuildingRevision。

本人仍通过town construction start/leave决定劳动。工程取消使用工程requestBase，加premises.cancel-construction，arguments:{type:"cancel-construction",id,expectedRevision}。已发生劳动保留，未使用材料退回原库存；建筑只在真实投入和劳动完成后产生，归项目controller，不归最后施工者。

建筑配置使用建筑requestBase，加premises.manage-premises，arguments:{type:"manage-premises",id,expectedRevision,command:{type:"configure",title,access:{entry:"public"|"listed",visitors:[],operators:[],residents:[]}}}。close/reopen或collect-salvage同样需要当前主体授权。使用者不是管理员；原许可与义务不被配置抹除。建筑控制交接使用principals control：当前控制方offer，目标主体独立accept；保留全部物理/使用/义务事实。

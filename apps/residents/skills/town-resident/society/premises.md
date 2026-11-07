# 土地、建设与真实设施

你自行选择是否建设、用途、合作人、名称和组织方式。sites list/read查询真实有限场地与初始土地许可；物理面积和“谁能使用”是不同规则。初始公共许可不是居民投票共识。普通文件或CLI不能创造土地。

construction plan --kind build --primary-use residence --floor-area 8 --capacity 2 --workstations 0 --care-stations 0 --teaching-stations 0 --storage-units 0 查询材料和实际工时。改造/维护/拆除用kind modify/maintain/demolish并给buildingId；没有完成工程就没有建筑、容量或资产。名字不创造疗效、学历、员工或收入。

供料方先在sites read的parentLocationId真实存料，然后materials reserve --id 保留ID --stock-id 库存ID --expected-stock-revision 当前库存版本 --beneficiary-kind resident或collective --beneficiary-id 发起方 --consumer-domain premises --consumer-id 未来工程ID --items '{"Wood":8}' --terms '原话' --expires-at 模拟毫秒。保留从库存实际移出，只供这一受益方和工程。未接收的offer可withdraw或到期退回；接收后不能单方面撤料。

工程控制方construction create输入蓝图参数、id/buildingId/siteId/expectedSiteRevision、controllerKind/controllerId、title/description、workers及reservationRefs。reservationRefs格式为保留ID@版本，可重复参数组合多方材料；合计必须恰好匹配蓝图。同意供料不等于同意为他人工作。

工人本人出行到外部作业地点，再construction start --id 工程ID --expected-revision 当前工程版本 --until 模拟毫秒。单工位一次一人，大家可自愿接续。leave只停止本人，已有进度/体力消耗保留。完工自动结算保留材料、建筑和真实双向道路；cancel只退未消费材料。construction read检查progressMs、workMs、lastStop、settlementBlock；完工结算阻塞后先处理原因，再finish重试，不会无限续工。

premises read查物理容量、状态；控制者及交接目标还可查权限、材料和未清义务。configure分别设置entry(public/listed)、visitors/operators/residents；公共进入不授予经营或居住权。居民本人决定是否housing choose；现有有效租约和物品不会因新ACL消失。建造设施不会自动提供服务，仍需本人服务供给。

offer/accept/cancel-offer独立交接，保留历史创建者和现有义务。正在施工的建筑不能转交。collectives的精确resource决定可创建/取消/结算工程、供料和管理建筑，不能代人start/leave。领取材料的决定必须绑定recipientId，执行者必须是这个人本人。

启用premises-facility-use-v1后，同一建筑的所有库存合计使用其实际storageUnits，未完加工投入、未来产物及可能退回的供料仍占预留；stocks read/premises read的facilityUse显示容量和粗粒度总用量，不显示别人的库存详情。每个正在加工的会话占一个实际工作位，进入和集体成员身份不代表经营授权。本人leave或完成释放工位，运营授权丧失会停止未来工作但不没收本人库存；库存清算和取回仍各按原权限。

当前物理模型每完整模拟日损耗1/1000条件，closed建筑仍自然老化；维护要真实新材料和工时。改用途须先处理义务并关闭，纯内部改造使用明确的材料/工时比例；原地扩建消耗余量，不能缩小已有容量。工作都在Site外部，允许维修尚不可进入的建筑。

close要求没有在场人员、居住/到达预留、租约、库存或服务义务。拆除先close，再提交demolish蓝图和本人劳动。实体材料按登记比例回收，残料留在场地，仍有控制者；本人到场premises collect-salvage --recipient-id 本人 --items JSON领取。最后一份残料清走才释放场地面积，损失有记录。

运行者可用带sourceId的register-construction-site作明确迁移；这不是居民的土地创造能力。默认上下文只含启用标志和四个查询入口，更多内容分页主动读取。各域组合和真实自主运行验收分别记录。

[construction参数](../commands/construction.md) · [材料保留](../commands/materials.md) · [设施参数](../commands/premises.md) · [场地参数](../commands/sites.md)

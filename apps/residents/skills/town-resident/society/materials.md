# 实物保管与实际生产

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

stocks settle停止新存入/订单，现有订单可完成或取消。关闭前实物归零且义务清结，不能借关闭丢弃别人的材料。默认上下文仅标志和查询入口；已读原文和真实回执会按个人阅读记录保留，更多状态自行查询。

[stocks参数](../commands/stocks.md) · [production参数](../commands/production.md) · [共同账户](funds.md) · [自主组织](index.md)

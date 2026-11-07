# 资源控制与独立交接

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

enterprise只交接经营权，两个revision均为控制版本，不代表企业全部财务版本。历史founderId不因交接改写；capitalShares是当前出资份额。个人管理者沿business/market原命令经营；集体必须提案并独立表态：resourceId固定企业ID，arguments包含expectedControlVersion和原命令参数，不再重复enterpriseId。支持business.post-job/layoff/close/authorize-service/revoke-service及market.trade/export/import。集体成员、旧创立人、普通员工不能直接动用公司资金。员工自己join/start/leave，服务双方自己接受及参加。

企业管理者通过city observe --view enterprises按页看本公司经营事实；个人工资用city observe --view labor。关闭须清结已有义务，余款和实物按已记录资本权益分配给权利人，不给执行关闭的管理员。business fund不会自动获得股份或债权。群体失去程序法定人数会暂停新管理决定，不强迫任何人继续留在组织。

目前资源管理不会转移货币、身体状态、社交关系或未实现的物理资产。manifest不自动改写。默认上下文只给入口，详细状态按需读。

[resources 参数](../commands/resources.md) · [集体决定](collectives.md) · [共同账户](funds.md) · [元能力](index.md)

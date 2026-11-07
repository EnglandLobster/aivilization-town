# 居民自己的有限周期付款

目的、合作方、金额和是否采用由你决定。这是一份明确的金融承诺；把正文写成租金、会费或学费不会授予住房、成员资格、教学效果或贷款本金。

先 town obligations list/read 查看当前当事主体有权读取的约定。付款方 obligations prepare --command '<完整JSON>' 获取精确请求：type为offer，填写id、title、terms、payer和revenue（sector与id）、amount、firstDueAt、periodMs、periods、acceptBy。时间均为绝对模拟毫秒，周期至少60000毫秒；金额为正且最多六位小数，最多128期。两方必须控制不同的真实账户。prepare不创建承诺、不扣款。

个人或当前企业管理者用 principals operate --request '<完整精确请求>' 发出约定；收款主体独立从 obligations read 取 accept 请求并操作。共同账户使用 collectives 精确 resource 决定，公共账户使用 governance 的 manage-resource 精确决定，批准整份有限总额和期限。普通成员、执行人或旧管理人的私人钱包不代替主体账户。私人周期能力可由运行者显式 enable-periodic-access 接入，不需要政府、不增加公共权限。旧 enable-periodic-obligations 是同时扩张公共范围的兼容路径。principals list 中 periodicAccess 给出当前独立接入策略；国库仍须另有公共范围和精确决定。启用不给原来文件补造同意。

接受后每期只按约定到期一次，实际资金和收入容量足够才真实支付。不足会保留明确欠付，后续时间不自动重试旧欠款、不借钱、加罚息或铸币。付款主体可从具体欠付期的查询回执取 settle 请求，按当前权限另行清偿；收款主体可取 waive 请求放弃该笔未付债权。集体或公共仍须独立批准精确动作。

任一原当事主体可以 terminate 停止尚未到期的未来付款，不能删除旧欠付、撤回已支付或替别人开始/停止身体活动。当前正好到期须先结算本期。管理权交接保留约定和历史署名，新管理者按当前权限操作，旧作者没有永久访问后门。有未来承诺或欠付时不能通过关闭共同账户/企业抹账。

常态上下文仅有查询入口，原文和各期记录分页按需读取。此能力尚未完成全模式接入、自然人遗产或企业整体清算；自动程序不能凭一次代理授权创建这类承诺。支付不代表主观满意或客观服务完成。

[完整参数](../commands/obligations.md) · [主体权限](../commands/principals.md) · [共同账户](funds.md) · [公共程序](public-procedures.md)

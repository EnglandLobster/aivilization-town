# 有限响应与长期协作进度

可以自行选择是否让精确版本的程序响应来源变化。先定义programs条件/步骤，所有被代理人分别mandates grant；然后runner本人用 town reactions watch --id 自选ID --program-id 程序ID --program-revision 版本 --max-reactions 检查次数上限 --expires-at 模拟毫秒 登记。登记不立即执行，不构成任何新的授权。

每个已提交事务若改变条件来源的记录版本、视图输入、本人相关事实、共同账户或集体决定，产生一次待检查机会。clock能作为条件；只有clock的流程请用已有programs schedule。无关人的私人活动不会因为全局事件序号变了就触发本人余额条件。

每次处理重新检查**当前**事实、全部来源访问权和全部mandates；排队期间撤权同样生效。过去的触发版本不是将来付款的依据。条件不满足记为skipped，检查次数已用、mandate成功次数未用；权限/版本/实际步骤失败使watch停止，不无限重试。条件仍满足时新的依赖版本可再次执行；只想执行一次请设max-reactions 1并限制mandate次数。

town reactions list 列本人参与的watch；read --id 展开固定程序版本、次数、到期和状态；history --id --limit 1读取每次真实排队/完成回执及来源提交序号，关联programs runs。内部依赖指纹不对居民公开。runner用cancel --id --expected-revision 当前版本取消全部待处理机会，不撤销完成的事实，也不消耗剩余mandate。

默认每runner最多20个watch（含历史），全局最多1000；每个最多100次检查、30模拟日；全局最多128条pending，每轮处理最多32次，剩余的持久保存。互相触发不会递归占用调用栈。队列超载停止相应watch并明确写reaction-queue-overloaded，原业务仍提交。watch本身不预留资金、库存或身体时间。

重启先回放旧事实，运行循环再恢复待处理项；同一个结果不会重新扣款。原交易回执仍指原交易的revision，后续响应有自己的提交和回执。旧实验由运行者显式enable-program-reactions（须已有conditions）；居民不能升级平台规则。

[reactions 参数](../commands/reactions.md) · [条件来源](conditions.md) · [固定步骤与授权](programs.md) · [元能力](index.md)

# 有界事件响应与持久协作进度（M08）

## 边界与语义

居民选择精确程序版本、响应次数上限、到期时间，并亲自登记watch。watch只请求重新检查程序，不构成新的mandate。每次业务执行重新验证程序、所有本人授权、条件来源的当前权限和真实资源。没有自动扩权、无限重试、递归调用或替居民参与身体活动。

响应单位是**已提交事务的依赖变化**，不是未提交的预演步骤或模型文字。一个事务内多次写同一来源只对最终事实生成一次机会；不同事务各有独立队列回执。来源是该版本条件中的记录/署名记录、聚合视图的真实输入、个人事实、共同账户和集体决定。clock可以作为执行条件；只有clock的程序使用已有精确模拟时间schedule，不把任意推进分段当作社会事件。

每次变化都重新检查当前条件，条件仍为真时可以再次执行。因此“只执行一次”必须设有限次数/mandate；watch不猜测居民希望一次还是每次。已经排队的旧变化不授予使用旧事实的权利：处理时来源已改变会按当前事实检查，并保留触发提交序号。记录条件不满足的skipped结果；失去权限、程序改版、资源失败会停止该watch，并明确取消其待处理队列，不自动重试。

## 归属与数据流

collaboration独立reaction模型拥有watch、有限次数/期限、持久队列、状态转换及回放，作为coordination的可选子状态；没有I/O、WorldProjection或LLM。worker只提供当前授权来源指纹和调用现有程序执行器的应用端口。

应用提交路径：原业务效果预演 → 检查依赖变化 → 追加入队/超限停止事件 → 同一journal提交。随后单独提交：读取持久pending → 当前校验/有限程序执行 → 业务效果、mandate成功次数、ProgramRun与reaction终态**同次原子提交**。基础设施journal不承担领域决策。原业务不能因为其他人的watch执行失败而回滚。

重启只回放事实，不自动执行新动作。正常运行循环通过有界resume入口继续pending；beginTurn、invoke、advanceTime在读取新命令状态前恢复；HTTP命令入口和daemon选人轮次也恢复。幂等重试返回原提交回执；已完成reaction绝不重新执行。来源事务与消费事务之间崩溃时队列仍在；消费事件与资金效果之间不存在可见中间状态。

## 状态、预算与隐私

watch：固定runner/program/version、参与者、maxReactions、expiresAt、enqueued/completed/succeeded计数、依赖指纹、revision与active/completed/cancelled/failed/expired。reaction：watch引用、原提交序号、触发时刻、pending/succeeded/skipped/failed/cancelled、最终时刻、ProgramRun引用与稳定原因。指纹是内部依赖比较用的哈希，不返回CLI或个人记忆，也不是证据或授权。

默认版本resident-program-reactions-v1：每个runner最多20个watch（含历史）、总1000个、每个最多100次响应、30天期限、全局128个pending、每轮最多32次消费。新来源变化超出pending预算时停止该watch并写明queue-overloaded，不拒绝原业务、不静默丢弃；终止待处理队列为cancelled，来源提交序号保留。每次真实程序执行仍受M07读取预算和既有8步/真实资源/mandate上限约束。

队列顺序按来源提交序号、watch ID、reaction ID稳定排序。消费循环有重入保护和全局轮次上限，互相写入只入队；超过本轮预算的合法pending留待下轮。取消/到期/失败不消费未用mandate、不预留资金或库存；这些watch本身没有资产预留。其他长期义务的释放仍由资源所属领域负责。

仅原程序参与者可读watch及其执行回执；只有runner能取消。来源访问先按M07检查所有程序参与者；未授权变化统一表现为来源不可用，不暴露原值/私人版本。个人事实指纹只采用授权的实际相关字段，不使用全局world sequence，以免其他居民活动导致误触发。公开视图不绕过底层ACL。

## CLI、上下文和兼容

`town reactions watch --id --program-id --program-revision --max-reactions --expires-at`；`list/read/history/cancel`提供分页状态、队列进度和中断原因。register命令不立即运行当前已满足的程序。实际程序内容/授权/效果通过programs和mandates查询；历史结果不等于当前来源访问权。

默认上下文只给启用状态和按需查询入口；不注入全城watch或来源正文。执行器保留既有参与者实际执行经历；停止watch的原因只通知其runner，原始队列回执读过才有对应已读经历。不会因为某人写了一条公共数据就直接唤醒全城LLM。

新manifest显式纳入可选programReactionsPolicy/provenance；旧manifest保持原字节，可显式enable-program-reactions幂等升级；旧coordination事件不补造watch。新入口仅在开放居民实验，canonical/分区统一接入由R01完成。

## 验证门槛

领域：正常/非法登记、权限与版本、次数/期限/队列预算、取消、稳定队列顺序、终态不可重复、事件重放和旧state。

应用：真实来源变更后付款、无关世界变化不触发、假条件继续等待、撤权/改版中止、后续步骤失败原子、独立多居民循环有界、来源已提交后模拟崩溃恢复、消费已提交后重启不重复、取消不消费授权、内部来源指纹不泄漏、超载不回滚来源、模拟时间到期与旧manifest升级。运行完整仓库检查/依赖build和真实编译CLI；真实模型与自然涌现实验仍单独验收。

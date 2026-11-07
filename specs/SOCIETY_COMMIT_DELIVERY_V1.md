# 完整社会提交投递 v1

R01的完整目标仍包括认证分区计算、权威调度、canonical迁移与故障恢复。本阶段建立供受信分区使用的完整事实投递，不把WorldEvent子集当作社会状态，不提供居民读取全城私人日志的入口。

唯一写入权威仍为OpenSocietyRuntime及其journal。投递包携带manifest摘要、已确认序号/hash、连续完整OpenSocietyCommit和下一游标。读取上限64条，接收端不接受客户端重新编排effects，不执行任何领域决策或反应队列，仅使用相同applyOpenSocietyCommit。hash用于完整性与世界绑定，不是签名；传输必须来自已认证的权威，居民token不得读取全量包。

接收journal有持久replica角色标记，普通Runtime打开即拒绝，防止接收者误变成第二个世界写入者。不能把已有权威目录转换为副本。每条组合提交先校验schema/hash/序号/请求唯一性及全部领域回放，再append/fsync，成功后才能确认。游标取自持久日志，不另存一个可能先于事实的ack文件。批次中断允许完整提交前缀已落盘，重投相同提交幂等；不同内容、错世界、断序、hash不一致和重复请求拒绝。未完整尾部沿用显式恢复，正常打开严格拒绝。

验收要覆盖同时含信息与经济事实、重投、完整回放、源继续增长、错世界/篡改/乱序、前缀成功后失败再恢复、禁止副本执行命令及误打开Runtime。此次不新增居民命令或上下文。不把本地受信投递称为已完成跨主机认证、owner分配、调度barrier或全部R01；本轮先通过server现有管理凭据提供完整事实HTTP读取和编译CLI接收，并做真实进程故障演练；独立分区凭据、归属与调度接入仍需继续。


## 当前接线与明确限制

`GET /admin/replication/manifest`及`GET /admin/replication/commits?sequence=...&hash=...&limit=...`只允许管理凭据，居民403、匿名401。管理凭据仍有原管理权限，不能冒充已经实现了分区最小权限；当前server仍监听本机。adapter `syncSocietyReplica`按最多1024页的显式预算拉取，默认16页/每页32提交，禁止重定向，逐请求30秒超时；返回caught-up只表示该次查询时已追平。上限按完整提交数，不拆分提交，不承诺固定字节大小。

`pnpm residents replicate --root REPLICA --source URL --source-credentials FILE [--pages 16]`读取本地管理凭据文件，不把token放进命令行或日志。满预算返回已落盘cursor，下次调用恢复；权威继续增长不改变过去hash。副本启动使用journal而非Runtime，因此不执行到期任务或居民程序。角色标记与新manifest在确认任何提交前同步到磁盘；正常Runtime与副本双向转换都拒绝。`recover-journal`显式识别既有副本角色并保留它，不能借恢复升级为权威。

测试包含完整信息/银行存款/时间效果、重复投递、增长后续传、错世界/hash/乱序/游标、重复request导致的批次前缀落盘后恢复、外部传入对象不改历史、角色隔离与部分尾部恢复、真实HTTP权限隔离。进程脚本`apps/residents/scripts/verify-commit-delivery.mjs`在接收落盘后SIGKILL，不保存返回cursor；通过编译CLI重开，journal不重复写入、后续完整状态相同、原存款只发生一次。此注入验证落盘后确认丢失，不冒充验证所有系统调用断电点。


## 最终验证

新增6项测试；全仓3156通过/1原跳过，470测试文件通过/1原跳过，lint、排序全仓typecheck、相关build与格式/diff检查通过。真实进程证据目录`.local/open-residents/commit-delivery-20261007-2`，报告与源码摘要见`evidence/SOCIETY_COMMIT_DELIVERY_2026-10-07.json`。首次lint/类型错误来自新测试回执和Array.isArray类型窄化，以及临时进程脚本误进入源码扫描，均已修正而未放宽检查。没有把工程测试当成模型或自然涌现验收。

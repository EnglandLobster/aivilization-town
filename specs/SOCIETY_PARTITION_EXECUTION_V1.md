# 分区计算授权与统一调度 v1

完整目标是分区Agent计算、唯一完整社会权威与可恢复运行，不允许副本执行领域决策。本阶段把独立分区凭据、静态居民归属、短期轮次令牌与时间屏障接到现有HTTP入口；后续还要接长期运行者、真实OpenCode和canonical迁移。

归属配置为显式运行者文件，版本resident-partition-scheduler-v1；当前所有居民恰好属于一个分区。分区凭据只能领取自己的居民轮次，不能读完整副本、调用管理API或冒充别区。模型只拿一次轮次令牌，经原/context、/capabilities、/invoke入口操作绑定居民，不传actorId。长期居民token在分区调度模式禁用，防止绕过轮次屏障。管理员start/finish/advance同样禁用。

权威进程分发随机短期令牌，wall clock只决定传输凭据是否到期，不决定身体或经济效果；所有模拟结果仍使用simulation clock。过期、结束或权威重启后旧令牌失效。到期不撤销已提交事实、不自动宣布失败；重新领取复用尚未持久结束的原turn和requestId去重。若已提交wait但供应商未交接，返回原turn与原summary，不能因为恢复新造行动机会。完成回执可在本权威进程内重试；权威重启后从原turn.finished事实恢复，不重复完成。

各分区可同时持有不同居民轮次，HTTP命令仍由单一journal顺序原子提交。存在任何未交接轮次或当前时刻待醒居民时，不推进模拟时钟；所有当前工作完成后才推进至下一个真实唤醒/活动/提醒边界，最多一天。离线分区可使屏障等待，这是真实限制，不能偷偷替它决策。此模式显式改变机会调度次序，不声称与串行daemon轨迹相同；事件重放保持确定。

配置与短期令牌属于外层计算授权，不属于居民社会授权；租约不会产生集体权限、扣款许可或本人身体同意。此阶段配置静态、单权威进程；不支持自动所有权迁移、多权威failover、跨主机锁或副本本地ACL查询。身份绑定、过期fencing、重试、wait后恢复、并行轮次时间屏障、原文/金钱原子性均需实际HTTP测试。


## 实际入口与恢复语义

权威：`pnpm residents serve --root WORLD --partition-config FILE --port 4320`。配置结构为`{version:"resident-partition-scheduler-v1",leaseMs:600000,partitions:[{id:"p1",token:"至少32字符随机秘密",actors:["resident-001"]},...]}`，必须覆盖全部当前居民且无重复。长期token不能与管理员/居民或其他分区token冲突。`partition-bindings.json`仅持久保存版本、分区ID与居民归属，不含token；已绑定世界缺配置启动server拒绝，重新分配也拒绝。显式token轮换允许，自动成员迁移/扩容尚未实现。

计算：`pnpm residents partition-run --root COMPUTE_DIR --source http://127.0.0.1:4320 --source-credentials FILE --model PROVIDER/MODEL --timeout 300000`。计算端凭据文件仅含`{partitionToken:"该分区秘密"}`；它不是管理凭据。一次调用执行一个领取到的自由机会，返回waiting表示别的领取者/分区仍在工作或屏障尚未解除。`--claim-id`允许本权威进程内重试领取；不同领取ID不会分享同一未过期轮次令牌。跨进程崩溃恢复依赖持久的未结束turn与实际请求ID去重，不声称跨重启持久保存claimID/finish缓存。

`POST /partition/claim`只接受claimId，`POST /partition/finish`由同一分区提交轮次令牌和供应商交接结果。完成重试在当前进程内返回原回执，变更内容拒绝；缓存限1024。旧轮次令牌重启后全部失效，未结束turn可重新领取；已持久结束的turn不会重新交接。已有wait/budget-exhausted恢复直接保存原交接，不再调用模型发新行动。客户端模型预算取自身timeout与权威返回剩余租期减250ms的较小值，server仍在实际操作前复核期限，包括HTTP读取body后的再次验证。SIGINT/SIGTERM先通知driver终止，租约过期不会回滚已提交事实。

当前计算入口为单机会adapter，服务监听本机，受限CLI仍要求本机连接；这是真实独立进程接入，不是完整跨主机部署。常驻分区循环、独立网络部署、故障后的供应商会话连续性、动态归属迁移与canonical旧数据迁移继续原R01范围。不能把管理只读副本当作分区居民查询来源。


## 本阶段验收结果

6项新测试覆盖归属、并发领取、过期与重启撤销、重复存款、完成回执冲突、wait后恢复、时钟屏障、HTTP凭据隔离、模型只获短期token及静态绑定。全仓3162通过/1原跳过，lint、类型检查与相关构建通过。

真实两个独立`partition-run`进程调用OpenCode，无剧情，均完成（97789ms、211458ms）。43调用、42成功、1次交易忙碌拒绝保留；全状态重放一致，两位各归所属分区，整个初始并行轮次simulationTime=0，未在另一居民尚未结束时推进时钟。实验目录`.local/open-residents/partition-opencode-20261007`。初版脚本通过条件未强制检查归属/时钟，原报告不改；另行读取权威明确断言两项通过，未来脚本已补条件。详见`evidence/SOCIETY_PARTITION_EXECUTION_2026-10-07.json`。

单次真实机会不证明持续运行稳定性，尚未验证长期分区调度和跨进程供应商会话恢复；保留这些后续工作，不能据此关闭R01/R02。

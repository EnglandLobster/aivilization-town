# 有界事件响应验收（M08，2026-10-05）

M08完成工程验收。居民以精确程序版本登记有限watch，依赖事务变化产生持久待处理机会；当前条件/来源权限/mandate和实际业务效果都在执行时重验。响应不是自动同意，不继承过期权限；无真实模型调用，不声称自然涌现。

collaboration的reactionModel/reactions拥有登记、队列、次数/期限、取消/失败/到期与确定性回放；programAuthorization从原programs拆出保持依赖单向。worker的reactionSources提供授权来源指纹，reactionExecution编排已有程序，reactionRuntime提供有重入保护的有限消费循环。journal仍只负责可靠存储/回放。来源效果与入队同次提交；程序效果、成功mandate计数、run及队列终态同次提交。来源不会因响应失败或队列超载被回滚。

新增5项领域、15项runtime测试：精确授权/版本/预算/旧state，依赖幂等、稳定队列/重放，取消/过期/超载，真实署名后付款，假条件跳过但不消费mandate，无关交易不触发，权限/程序/mandate变动停止，后续步骤失败原子，来源提交后中断、消费提交前/后中断，重启只回放再显式恢复且不重复付款，历史排队按当前事实重新检查，多居民双向循环有界续跑，视图输入变化，模拟到期整段/分段一致，历史分页/真实阅读和旧manifest幂等启用。

另外修复共同账户world事件ID未绑定actor的问题：两个居民使用同一个各自合法的requestId时仍产生不同事实ID，8项共同账户runtime测试包含对应回归；历史事件不改写。

`pnpm check`通过：lint、全仓有序typecheck、2323项测试通过、1项既有跳过；315个文件通过、1个跳过。residents完整依赖build通过，最终worker/residents重建通过。新增5项命令，当前243项能力/47个命令组/77页生成Skill；版本resident-program-reactions-v1、open-capabilities-v14、town-resident-skill-v13、society-rulebook-v6。

编译后的CLI/HTTP验收19次调用：登记不立即执行、假条件继续等待、独立署名变化真实付款、非参与者不可看watch、有限回执页、撤权自动停止、取消不花剩余次数、全程货币供给不变、重启state与journal字节一致。证据：[SOCIETY_PROGRAM_REACTIONS_2026-10-05.json](evidence/SOCIETY_PROGRAM_REACTIONS_2026-10-05.json)；脚本apps/residents/scripts/verify-program-reactions.mjs。

响应单位是事务最终事实，不是内部未提交预演；clock-only使用已有schedule。旧待处理项保存来源提交但执行检查当前事实；各项结果明确记录，不能据此宣称捕获每个未提交瞬态。每轮32次、全局pending128、每watch至多100次/30日；超限留下明确停止原因。内部指纹不进入CLI/记忆，watch本身不占资金/库存。默认上下文仅启用状态与查询入口。真实资产/长期义务的交接与清算继续属于M06/M09及W域，canonical/分区接入和真实Agent验收仍属R01/R02。

# 条件与署名依据验收（M07，2026-10-05）

M07完成工程验收。原文陈述、本人署名陈述、居民计算、程序事实与世界事实保持不同来源；任何条件通过都不产生新的行动权限。本报告没有真实模型调用，不声称自然涌现。M08事件响应另行实现，完整社会目标继续推进。

collaboration拥有闭合条件语言、预算、比较和来源分类；worker通过只读端口提供当前授权的实际数据。程序作者、运行者和所有被代理人都须有当前来源访问权，先检查全部权限再读取。本人签署要求实际编辑者和授权人都等于指定签署人；代理代写不会冒充本人签署。所有条件、授权与步骤基于同一事务快照，失败不付款、不消费mandate，也不留下前半段业务效果。程序版本变更使旧mandate失效。

新增5项domain测试、13项runtime测试：闭合语法/数值/预算、版本和旧事件、签署身份、无值泄漏、撤权、部分条件不得泄漏、查询与执行分离、步骤失败原子、视图双ACL、原作者失去访问后合法读者仍能计算、非法空聚合/除零、个人事实不能通过代理暴露、真实共同余额/集体决定、旧manifest显式启用与重启相等、跨周期定时条件等价。

`pnpm check`通过：lint、全仓有序typecheck、2302项测试通过、1项既有跳过；313个测试文件通过、1个跳过。residents及全部依赖build通过。当前238项能力、46个命令组、75页生成Skill；新增programs.check。版本resident-program-conditions-v1、open-capabilities-v13、town-resident-skill-v12、society-rulebook-v5。

编译后的真实CLI/HTTP脚本验证：独立居民签署、假条件不付款/不消耗次数、真条件引用实际版本付款、居民聚合触发本人预授权消息、撤回来源访问阻止检查和执行、真实运行回执分页、重启状态和journal字节一致。证据：[SOCIETY_PROGRAM_CONDITIONS_2026-10-05.json](evidence/SOCIETY_PROGRAM_CONDITIONS_2026-10-05.json)；脚本apps/residents/scripts/verify-program-conditions.mjs。

默认上下文仅给启用状态，完整来源和条件按programs.read/check/runs展开。旧定义不补写条件字段；旧manifest不改写，通过幂等启用事件升级。新能力仍属于独立开放居民实验；canonical和分区authority的迁移属于R01，不由这些测试替代。

# 群组共同控制切片验收（2026-10-05）

M06/M09群组控制切片完成；服务、车辆、设施、企业、长期义务和整体清算仍在完整交付范围。这里是工程验收，没有调用模型，没有自然涌现结论。

管理权、个人成员身份、原始作者分离。集体接管/办理邀请/接受申请/撤销邀请/关闭需精确决定，普通成员身份不能代替执行授权。管理者不自动入群或读历史，邀请须接收者亲自接受；申请可本人撤回。交接终止未决邀请和申请，记录实际执行者与controller-transfer原因，不伪造接收者拒绝。旧创建者不能凭ownerId恢复管理权；已有成员、发言作者和内容保持原样。

新manifest显式登记resident-group-control-v1；只有旧resource-control策略的实验不自动改变群组创建/转让行为。enable-group-control提交一次GroupControlEnabled事件，不改manifest或已有群组。受控群组禁用单方groups transfer，用独立offer/accept；旧未转换群仍保留旧语义。

新增6项information领域与5项runtime测试，以及1项CLI版本来源断言。覆盖个人/集体交接、原管理权撤销、非成员管理者、消息ACL、成员个人参与、撤回后决定不消费、真实联系人屏蔽、关闭历史保留、原子/回放、旧manifest显式幂等升级。manifest中的transport/skill/rulebook版本现在来自与生成Skill和实际目录相同的常量，历史manifest不改写。

`pnpm check`通过：lint、全仓有序typecheck、2352项测试通过/1项既有跳过，319文件通过/1跳过；residents及依赖build通过。251项能力、48组、79页Skill；open-capabilities-v16、town-resident-skill-v15、society-rulebook-v8。

真实编译CLI/HTTP 31次：集体独立投票接管、禁止凭管理权读消息、禁止旧创建者继续邀请、终止旧邀请、申请本人撤回、独立接受新邀请、实际成员署名发言、集体关闭后保留成员历史和拒绝新消息。重启state相等且journal字节未变。[原始证据](evidence/SOCIETY_GROUP_CONTROL_2026-10-05.json)，脚本apps/residents/scripts/verify-group-control.mjs。

上下文仅启用标志和查询入口；控制元数据、邀请、成员、消息分别按权限分页。原文作为消息陈述，不被制度接管改名或变成世界事实。canonical/分区、其他资源和真实Agent组合由剩余W/R契约继续推进。

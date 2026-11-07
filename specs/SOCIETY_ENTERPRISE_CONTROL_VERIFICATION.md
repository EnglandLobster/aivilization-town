# 企业共同经营控制切片：工程验收

2026-10-05。对应M05/M06/M09/W06的组合增量，不代表完整25项完成，也不是自由居民已经组建企业。

- `pnpm check`通过：lint、全仓typecheck、2753项测试通过/1项跳过，391文件通过/1文件跳过。日志`/tmp/enterprise-control-check-2.log`。
- `pnpm --filter @aivilization/residents... build`通过，含领域公开exports与生成的居民Skill。
- 编译后真实认证HTTP/CLI：`node apps/residents/scripts/verify-enterprise-control.mjs`；详见同名JSON证据，含独立集体接受、精确双人投票、旧管理者/普通成员拒绝、本人入职、失败不消费决定、清算给真实权益人、守恒和逐字节journal重放。
- Domain/world/runtime另外验证：个人/集体控制交接、期限/取消/版本竞争、当前权限证明、实际服务收入与本人劳动工资、集体材料与企业工资联合授权、独立开工、旧合同和已赚债权不因交接消失。有限小数资本清算不把余款给操作员；无效资本来源明确拒绝。
- 新自由运行中暴露的招聘时间错误已修复未来事件：publicLabor模式记录实际招聘周期结束时刻；旧模式和历史事件不改写。与本次门禁一起验收。

版本：catalog42 / Skill41 / rulebook31；仍为360条既有操作路由，新manifest记录enterpriseControl来源。默认上下文不批量灌入企业账本；详情沿resources、city observe enterprises、business service和个人labor查询，集体经营格式见居民society/resources.md与materials.md。

限制保留：管理交接不等于股份转移；business fund不创造新股或借款；企业原子有偿交接待显式程序版本；全部长期债务、永久清算、继任、人口退出及canonical/分区接入继续。当前服务目录管理本身与engagement真实财务授权仍是不同对象，不宣称集体目录管理已补齐。

[机器证据](evidence/SOCIETY_ENTERPRISE_CONTROL_2026-10-05.json) · [边界Spec](SOCIETY_ENTERPRISE_CONTROL_V1.md) · [原目标对照](SOCIETY_GOAL_ALIGNMENT_REVIEW.md)

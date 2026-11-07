# 预约、课程、活动与出行

`town services publish` 声明你提供的 appointment/course/event/transport/lodging 服务；这不会授予场地产权。
`services schedule` 提供模拟时间的 start/end 和容量。预约 request 需要服务者 accept；容量同时检查重叠时间段和真实地点上限。
`bookings check-in` 要求本人实际到场、到达预约时间且没有其他忙碌活动；新实验可用 --until 选择较短参与时长，bookings leave 可提前离场并释放自己的时间。交通行程不能通过离场瞬移终止。未参与而到期的预约变为 expired。
`bookings cancel` 在参与前取消，释放容量。`queues join/leave/status` 管理你自愿加入的队列，服务者 `queues call` 按顺序提供可用名额。

新实验的 appointment/course 默认为 hosted，提供者先 services start（课程也可 courses start）实际到场并投入时间；event/transport/lodging 默认 self-service，不虚构人力投入。新预约结束为 ended，记录实际时长与提供方重叠时长，不代表满意或履约。旧 v1 保留 completed 语义。
课程：教师先 `courses start --id 时段ID --expected-revision 当前版本` 实际开始授课，学生随后签到；结束后教师可以 `courses assess` 留下原始评语。评语不会凭空增加教育分数。居民真实教学及收费沿用engagements的guided-study模型。engagements models按需显示身体结算版本；service-time模式将服务消耗、效果和自然变化按同一实际时间结算，体力耗尽或一方离场会停止未来服务。服务分成与企业合同工资不同，不能重复开business work占用同一段身体时间。显式service-employment模式可把payer/revenue账户设为enterprise，公司当前控制者独立business authorize-service，选择none/attendance/effective-service。本人开始前engagements read查看ownEmployment，并在engagements start附上--expected-employment-revision；患者仍独立accept/start。在岗等待可以按约定计工资，但不产生服务费或药效。business service按需查看授权/收付，city observe --view labor查看本人债权；离职、解雇或提前离开保留已赚欠薪。显式public-labor模式下，初始公共岗位沿business work开始，国库先保护全额计划工资，之后按实际工时付本人和税；资金不足在开始前拒绝，不偷偷打折或铸币。本人life stop-work提前结束、未赚部分退国库；city observe --view labor只查询本人来源和已付款。这些初始工时不生成真实产品/医教服务，也不代表居民已经创建公共机构。education study是明确场景/外部课程；启用elapsed-study后只按实际时间积累和收费，提前结束用education stop --id 过程ID --expected-revision 当前版本，未用款退原付款方。自己的历史用city observe --view study，单个过程另加--section 过程ID；规则用city observe --view rules --section study。没有启用时保留旧模式。初始义务教育资助不是你新提议的公共采购；考试沿用education apply-exam。启用education-authority后，学习积分与正式学历独立；city observe --view qualifications查看本人当前认可、来源与考试条件。历史分数派生资格保留不代表参加过考试。city observe --view rules --section index列出实际规则分区及查询命令；occupations分区是初始岗位目录，私营企业仍能自定岗位名称。
活动：使用 event 时段安排场地与实际参与；作品、感想、照片说明等原文走 files/apps。
交通：transport 需要 --destination-id；签到触发真实世界移动，路线与时长由 world 检查，预留时段不能短于实际行程。也可以随时自主 `travel go`；没有“想旅游”的预设任务。
住宿：lodging 提供临时在场的预约，不改变永久住所。永久合住见 leases。
价格协商及付款可组合 offers/orders；预约本身不自动扣款。公开文字、预约成功与真实到场是不同事实。
[服务](../commands/services.md) · [预约](../commands/bookings.md) · [队列](../commands/queues.md) · [课程](../commands/courses.md) · [生活索引](../life/index.md)

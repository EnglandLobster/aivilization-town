# 预约、课程、活动与出行

`town services publish` 声明你提供的 appointment/course/event/transport/lodging 服务；这不会授予场地产权。
`services schedule` 提供模拟时间的 start/end 和容量。预约 request 需要服务者 accept；容量同时检查重叠时间段和真实地点上限。
`bookings check-in` 要求本人实际到场、到达预约时间且没有其他忙碌活动；新实验可用 --until 选择较短参与时长，bookings leave 可提前离场并释放自己的时间。交通行程不能通过离场瞬移终止。未参与而到期的预约变为 expired。
`bookings cancel` 在参与前取消，释放容量。`queues join/leave/status` 管理你自愿加入的队列，服务者 `queues call` 按顺序提供可用名额。

新实验的 appointment/course 默认为 hosted，提供者先 services start（课程也可 courses start）实际到场并投入时间；event/transport/lodging 默认 self-service，不虚构人力投入。新预约结束为 ended，记录实际时长与提供方重叠时长，不代表满意或履约。旧 v1 保留 completed 语义。
课程：教师先 `courses start --id 时段ID --expected-revision 当前版本` 实际开始授课，学生随后签到；结束后教师可以 `courses assess` 留下原始评语。评语不会凭空增加教育分数，正式学习/考试沿用 `education study` 和 `education apply-exam`。
活动：使用 event 时段安排场地与实际参与；作品、感想、照片说明等原文走 files/apps。
交通：transport 需要 --destination-id；签到触发真实世界移动，路线与时长由 world 检查，预留时段不能短于实际行程。也可以随时自主 `travel go`；没有“想旅游”的预设任务。
住宿：lodging 提供临时在场的预约，不改变永久住所。永久合住见 leases。
价格协商及付款可组合 offers/orders；预约本身不自动扣款。公开文字、预约成功与真实到场是不同事实。
[服务](../commands/services.md) · [预约](../commands/bookings.md) · [队列](../commands/queues.md) · [课程](../commands/courses.md) · [生活索引](../life/index.md)

# 居民自己的共同程序

可自行决定用途，不要求成立任何特定机构。town collectives list 可发现本人创建、受邀或仍参加的章程；read 展开，history 分页看自己有权读取的旧版本。决定用 decisions --collective-id，原文用 decision --id。

create 的 --configuration 是单引号包围的完整 JSON：{"title":"自定名","terms":"章程原话","members":["本人ID","另一人ID"],"voters":["本人ID","另一人ID"],"threshold":2,"quorum":2,"timing":"early","revote":true}。例子只说明格式，不是建议制度。members 必须含发起人，voters 是成员子集；threshold 为最少赞成人数，quorum 为最少回应人数（含弃权），且 quorum >= threshold。timing 可 early（达门槛可结算）或 deadline（只能到期）；revote 决定截止前能否改票。

create --id ... --configuration 'JSON' --expires-at 模拟毫秒 只记录自己的接受；其他人用 respond --id ... --expected-revision 当前版本 --accept true/false 独立选择。全体接受才激活；发起人可 withdraw 筹备。系统不把群聊成员或名册字段当成已经加入。

propose --id ... --collective-id ... --expected-version 章程version --terms 原话 --action 'JSON' --closes-at 投票截止 --execute-before 执行截止。提案原文不可原地修订，另建 ID 即新提案；提案人不会自动投赞成。动作可以 {"kind":"statement"}，或 {"kind":"amend","configuration":完整新配置}。resource 可连接[共同账户](funds.md)、[资源与企业管理](resources.md)、[实际生产](materials.md)及其他已有领域，具体操作须所属真实资源adapter可用；未实现操作明确拒绝。

vote --id 决定ID --expected-revision 最新版本 --vote yes/no/abstain 只代表自己。先读再投，不能覆盖别人回应。decide 只按冻结的名单/门槛/时间计数；模拟截止也会收口。通过 statement 只证明程序通过原文，不证明原文正确，也不转账。

修订依旧章程通过。新增成员需 join --id 决定ID --expected-revision 最新版本 --accept true，本人可拒绝。随后 execute 才原子更新章程并消费决定；未全部同意时旧章程继续有效。新版本使旧的未执行决定失去执行权。历史同意记录保留原来版本，不伪造所有人重新签署。

leave --id 章程ID --expected-revision 当前版本 移除未来成员/选民资格并提升权限版本。冻结投票仍可如实收口，但真实执行复核最新权限。退出不转移资产、不抹债务、不分配余款。若剩余人不足原门槛，程序暂停，平台不降低门槛或指定接班人。

最多30名成员、个人累计创建20个集体、每集体20个开放/500个历史决定；期限最多30模拟日。所有时间为模拟毫秒。list 每页最多30；大原文页过长时减少 limit。这里的邀请不会自动写入其他人的已读或模型目标。

[collectives 参数](../commands/collectives.md) · [元能力](index.md)

# 居民定义的有限流程

你决定用途；平台不从自然语言猜测操作，不要求你采用任何组织。

## 定义与查看

town programs publish --id 自选ID --title '自定名称' --purpose '目的原文' --runners 执行人ID --definition 'JSON对象'

definition 形如 {"steps":[{"principalId":"实际授权人ID","capability":"payments.transfer","arguments":{"targetId":"收款人ID","amount":5,"note":"付款原话"}}]}。

这是格式示例，不是付款建议。替换为真实居民 ID。可选conditions格式见[条件与署名依据](conditions.md)；旧实验须显式启用。最多8步，执行顺序固定。基础步骤：

- payments.transfer：targetId、amount、note。来自 principal 实际账户；金额乘授权次数是总支出上限。
- messages.send：recipientId、content。完整原话被授权；回执保留 principal 发送身份、实际执行人、授权 ID 和流程 ID。
- records.put：registerId、key、expectedRevision、values。必须匹配最新条目版本和当前编辑权限。
- records.append：registerId、values。每次运行生成独立稳定 key，适合重复记录。

arguments 必须精确包含上述字段，不接受 actorId、额外权限、脚本、递归或模型判断。不自动执行移动、劳动、治疗等身体行为，它们仍可由本人使用既有 CLI。

显式启用 resident-program-actions-v2 后，definition 加上 "actionPolicyVersion":"resident-program-actions-v2" 可使用 resource.control。先 town rules read --id resident-program-actions 查看是否启用；旧实验由运行者 enable-program-actions，不是居民命令。

resource.control 的 arguments 为 {"resourceKind":"space","resourceId":"实际资源ID","expectedRevision":当前修订,"control":{"type":"offer","expectedVersion":当前控制版本,"target":{"kind":"resident","id":"接收人ID"},"expiresAt":到期模拟毫秒,"terms":"移交原文"}}。accept/cancel 只需要 control.type 与 expectedVersion。种类支持 premises、stock、space、register、view、group、service；service 还需显式启用 resident-service-control-v1。须按对应 CLI read 查询真实版本。当前只开放个人控制主体的程序组合。

新实验可显式启用resident-program-actions-v3，允许resourceKind为enterprise；企业expectedRevision和expectedVersion都来自resources read的当前管理版本。旧实验由运行者enable-enterprise-programs单独升级，原manifest及已签v2程序不改写，v2仍不能写enterprise。企业交接只转管理，股份、现金、物品、雇员、工资和合约仍在原企业；付款不自动成为股权认购或公司收购。

可以自行把卖方 offer、买方 accept、买方 payments.transfer 放入同一固定程序；每位 principal 独立授权这一版全部步骤。后续步骤读取前一步后的真实版本。全部步骤成功才提交，否则钱和资源都保持运行前状态，成功次数也不消耗。不会在中途留下可被第三方接受的报价。已在程序外存在的普通报价仍按其原语义，不能靠文本给旧报价追加收费限制。

programs runs 按需展开每步 principalId、executedBy、mandateId/revision、程序修订、步骤索引与实际事件摘要指纹。代执行不会成为本人到场、签名观点或投票。控制交接不更改原作者、已有内容、地点、现存许可或其他聚合的义务。车辆和集体程序组合尚未开放；不得把它们伪装成上述资源种类。

programs list/read/history 查看自己拥有、可执行或需自己授权的版本。programs revise 仅 owner 可执行，需最新版本；修订使旧授权失效，历史保留。programs disable 停止未来执行，不撤销既往事实。

## 本人授权

每个 principal 都须自己使用 town mandates grant --id 自选授权ID --program-id 流程ID --program-revision 精确版本 --runner-id 指定执行人 --max-runs 次数 --expires-at 模拟时间。

先 programs read 理解固定步骤。作者自己的步骤也要授权。不能转授权或修改参数扩大权限；可 mandates revoke --id 授权ID --expected-revision 最新授权版本。成功运行会增加授权 revision，先重新查询。授权不锁钱，后续可能缺钱或失去访问权。

执行人 town programs run --id 流程ID --expected-revision 精确版本。全部步骤一起成功，或全部不发生。失败留记录，授权次数不消耗；回执不含他人余额/私密条目。重试保持相同 request-id。

## 时间与失败

town programs schedule --id 计划ID --program-id 流程ID --program-revision 版本 --start-at 未来模拟毫秒 --interval-ms 间隔 --runs 有限次数。

仅 runner 本人可安排。间隔至少60000模拟毫秒；最多100次，末次须在30模拟日内。每次重查授权/余额/ACL；任一次失败就停止，由你决定是否修订或重新安排。不会暗中重试。

programs schedules 查看自己的计划；programs cancel 用计划 id 和最新 expected-revision 取消未来执行。programs runs 查看相关执行事实；memory 检索参与经历。时间不是现实 UTC。

签署章程、文档说“同意”、程序 published，都不等于 grant。主观满意、信誉和组织成效由居民判断。

[programs 参数](../commands/programs.md) · [mandates 参数](../commands/mandates.md) · [元能力](index.md)

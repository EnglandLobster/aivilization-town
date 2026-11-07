# 公共程序与居民自己的选择

这是能力说明，不是政治任务。你可以提案、反对、弃权、交流、提出异议或不参与；制度通过不代表观点正确。

先用 town governance status 查看实际启用情况、初始授权来源、当前程序、政策修订和财政边界。初始多数程序来自场景，不是假称你已同意；私人群主或章程不能自造征税权。

## 精确提案

town governance propose 的 --action 接受一个单引号包裹的 JSON 对象。顶层是 kind、expectedRevision 和 terms；不填写 actor、authority、source 或 policyVersion。

- set-employment：仅当status中employment启用。用town governance employment分页读完整occupations以及terms；--revision可查旧版或下一周期版。terms包含完整occupations数组、quotaByResidentialTier、ranking、defaultOccupationCapacity、occupationCapacityOverrides。每个职业条款是occupationName、minimumResidentialTier、educationFloor、eligibilityShare、prerequisiteCommodity（可为null）。ranking可从knowledge、housing、submitted中选择不重复的排序顺序；稳定ID最终破同分。expectedRevision取latestRevision。修改从下一招聘周期生效；不重试旧申请、不改变工资、已有学历或私人雇佣。是否提案及具体值由你决定。
- set-tax：expectedRevision用currentPolicyRevision；terms为 neutralRate、incomeTaxBrackets、tradeTaxRate，可选dividendTaxRate。每个税档是 upToAmount 与 rate，最高档upToAmount可为null；税率0到1。你自己选择具体值。
- set-budget：expectedRevision用currentPolicyRevision；terms为 cadenceMs、minimumTreasuryReserve、allocations。每条allocation为 service 与 amountPerCadence；服务种类和资金边界见status。cadenceMs至少60000，这是结算工作量边界。
- set-subsidy：expectedRevision用currentPolicyRevision；terms为 minimumBalance 与 maxSubsidy，仍受公开财政边界约束。
- set-procedure：expectedRevision用procedureRevision；terms完整保留或修改status中的procedure。electorate不得超出grant.residents；minimumTurnout与minimumYes是人数；allowVoteChanges是布尔值；minimumVotingMs、maximumVotingMs、executionWindowMs以毫秒计；executors可以是字符串electorate或名册内的居民ID数组。修改必须经旧程序通过，未执行的旧程序权限随后失效。
- invalidate-decision：此项不用terms；顶层为kind、proposalId、expectedRevision、reason，指向尚未执行的已批准提案。已经发生的事实不能这样删除。
- fund-service：仅当status中procurement启用。顶层为kind、engagementId、expectedRevision、maximumCharge，不用terms。先用town engagements read查一份已由接受者独立接受、payer为treasury/public-treasury的合同；expectedRevision与maximumCharge必须精确一致。服务条款不能在批准后替换。

- fund-goods：仅当status中goodsProcurement启用。顶层为kind、orderId、expectedRevision、amount。订单必须指定treasury/public-treasury付款、绑定实际freight，并已由买方独立接受。用town trades read查准确修订与金额。

--expected-procedure-revision另行绑定当前程序。--closes-at是绝对模拟时刻，需考虑其他居民是否有机会阅读与表态，不是持续时长。原文理由放--text，不会被当作执行代码。

## 选择、结果与执行

town governance read --id 提案ID 可读原文、精确动作和冻结程序；votes与objections分页读取独立表态和异议。vote的--choice为yes/no/abstain，必须本人使用最新--expected-revision。人可以按允许的程序改票；不能替别人投票。

截止后close记录程序结果，并不执行政策。符合执行资格的人可execute精确获准动作；目标政策修订、期限、边界或资源条件变化可能使它失败。失败不消费决定。propose/vote/close/execute是可选操作能力，不要求你按示例完成某个政策目标。

object只保存署名异议，不自动裁决、扣款或暂停世界。若想撤销未用决定，需要另提invalidate-decision并获得批准。未支持的公共权力不会因为正文自称法律而生效。

## 可选的实际公共采购

status没有procurement时，预算仍是原有抽象公共服务账户。显式采购模式会停用自动预算分配，set-budget不能再写非空allocations。已有公共工资、福利、预置学校等另有规则，不因采购功能自动消失。

供应者可用engagements offer指定payer-sector treasury、payer-id public-treasury。此选择把合同条款、参与者和资金/时长账目公开；他人的身体数值仍不公开。接受者独立accept后，居民可按自己的理由提出fund-service。engagements fund不能自行扣国库。

公共批准和execute只把最高总价从国库放入服务托管，不代表任何人已经出勤。供应者和接受者仍各自start；实际共同时间与投入才产生费用和已建模效果。提前leave/cancel或到期会停止未来服务，未用款退回原国库。engagements read与ledger可查看履约和退款；没有官方满意度评分或自动共识。

实际物品可用trades offer选择treasury/public-treasury付款；这会公开订单、所关联货运及账目。买方accept只表示同意，不扣国库。精确fund-goods提案通过并execute才托管货款；承运人仍需本人装载、移动和交付。买方验收或双方和解沿既有订单程序，退款回原国库。资金来源不改变目的库存的私人或集体归属，这并非公共资产登记。

[完整命令](../commands/governance.md) · [私人章程](collectives.md) · [自主组织](index.md)

# 共同账户与真实支出

可以使用集体程序共同管理真实资金，也可以不使用。普通records里的余额不是这个账户。funds open --id 自选账户ID --collective-id 已激活集体ID --title 原话 只能由当前成员创建，初始余额为0；发起人没有个人提款权。

funds list 只列本人当前参与的控制集体账户。funds read --id 账户ID 提供收款地址、名称、状态、revision和controlVersion；当前成员还能看实际balance。非成员知道账户ID也可自愿入资，但不能因此看到余额、全账或获得成员/股权/债权。

funds contribute --id 账户ID --expected-revision 当前revision --amount 金额 --note '出资说明' 真实扣本人余额。入资只在open状态接受；其他操作更新revision后须重读，不可冒名付款。

支出用 collectives propose 的 resource action：{"kind":"resource","capability":"funds.transfer","resourceId":"账户ID","arguments":{"controlVersion":1,"recipient":{"sector":"agent","id":"真实收款人ID"},"amount":5,"note":"支出原话"}}。这只是格式；金额和用途由居民自己决定。收款sector可为 agent、collective、enterprise、treasury；国库ID必须 public-treasury。给企业资金不自动买入股份。

提案通过后 collectives execute --id 决定ID --expected-revision 决定当前revision 才真实支出，账户变化和凭据消费一起发生。缺钱/过期/章程改版/状态改变时全部拒绝，失败不消耗决定。新入资不改变controlVersion，未过期的同一精确决定可在补资后再执行。不能修改收款人或金额；需要另建提案。相同request-id重试返回原结果，不能重复付款。

清算先通过 {"kind":"resource","capability":"funds.beginSettlement","resourceId":"账户ID","arguments":{"controlVersion":当前值}}；执行后停止新入资，controlVersion提升。用新的controlVersion通过精确支出，逐笔处理清算；余额为0且无未处理义务后，通过并执行 funds.close（同样只有controlVersion参数）。关闭不会分配或销毁钱，不会抹掉历史。

funds ledger --id 账户ID --limit 10 供当前成员查询真实交易、实际账户revision和决定来源，按本账户版本顺序分页，最多30。全量页过大时减小limit，避免把截断原文当完整账目。个人只对自己的转账/收款形成实际经历；别人的余额和私密章程不随收款广播。

每集体最多20个账户；余额最多10亿、单次转移最多100万，所有数值finite且可可靠表示。每账户最多10000次入资，限额不会阻止已有资金支出和清算。关闭历史仍可查询。旧实验运行者须显式 enable-common-accounts，并先启用collectives。

[funds 参数](../commands/funds.md) · [集体程序](collectives.md) · [元能力](index.md)

# 交易、分摊与押金

先 `town offers publish --help` 发布有价报价。goods 必须是实际可交易商品；service 是自由描述的服务。
买方 `orders create` 指定报价版本和数量，卖方 `orders accept` 时实际库存被托管，其他订单不能再使用。
买方 `orders pay` 将自己的真实余额转入订单托管。卖方 `orders deliver` 的默认交付需要双方同地且空闲；服务报价可选 --delivery-mode remote，允许远程交付原始作品；商品不能远程传送。商品转入买方库存，服务交付仅是卖方声明。
买方认可后 `orders confirm` 释放托管款项。未交付可 `orders cancel` 退钱并释放库存；`orders dispute` 保留原文并暂停确认；卖方 `orders refund --amount 金额` 可授权部分或全部退款，不能超过实付未退部分。争议可通过 orders propose-settlement 指定剩余托管退还买方的 amount 和原始条款，对方 orders respond-settlement --accept true 才结算；false 可拒绝。余款付卖方，未交付预留货物退回卖方，已交付货物不自动退回。
报价撤下不悄悄取消已经接受的订单。

- `payments transfer`：从你自己的账户向另一人真实转账。
- `payments request --payers 居民ID --payers 另一ID --amount-each 金额`：等额分摊请求，每个人独立 `payments pay`，不能替别人扣款。
- `deposits lock`：自愿锁入押金。受益人 `deposits release` 退回付款人；付款人 `deposits settle` 付给受益人。
- 租约押金由 leases 管理，不能绕过租约接口提前处置。

所有写入支持 --request-id 幂等重试。成功以真实事件、账户和库存为准，发帖不是下单。系统不判定“好吃”或统一评分；你可以保留自己的印象并发布原始评价。
[报价](../commands/offers.md) · [订单](../commands/orders.md) · [付款](../commands/payments.md) · [押金](../commands/deposits.md) · [生活索引](../life/index.md)

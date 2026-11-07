# trades

## trades rules

```text
town trades rules [flags]
Read real fulfillment, independent acceptance, escrow and dispute rules.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades list

```text
town trades list [flags]
List orders visible to your current personal or collective authority.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades read

```text
town trades read [flags]
Read original terms, real source facts and exact accounting; delivered never implies satisfaction.
--id <string> (required) maxLength=60 Exact evidence order ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades ledger

```text
town trades ledger [flags]
Read authenticated original statements and financial receipts.
--id <string> (required) maxLength=60 Exact evidence order ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades offer

```text
town trades offer [flags]
Offer a priced order for one unstarted freight, unpriced service or offered permission; the buyer must independently accept. Treasury freight contracts and fulfillment become public; funding requires governance fund-goods approval and does not create public ownership.
--id <string> (required) maxLength=60 Exact evidence order ID
--source-kind <freight|service|permit> (required)
--source-id <string> (required) maxLength=96 Exact existing physical process ID
--source-revision <integer> (required) min=0 max=9007199254740991 Current source revision from trades read or original unstarted source
--payer-sector <agent|collective|treasury> (required)
--payer-id <string> (required) maxLength=96 Buyer-controlled account, or public-treasury for explicitly enabled public freight procurement
--revenue-sector <agent|collective> (required)
--revenue-id <string> (required) maxLength=96 Seller-controlled revenue account
--amount <number> (required) min=0 max=1000000 Total price, at most six decimal places
--accept-by <integer> (required) min=0 max=9007199254740991 Simulation acceptance deadline
--title <string> (required) maxLength=120 Original title
--terms <string> (required) maxLength=8000 Original price and fulfillment terms
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades accept

```text
town trades accept [flags]
Buyer independently accepts immutable terms. Private funds escrow now; treasury freight awaits governance fund-goods approval before fulfillment.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades withdraw

```text
town trades withdraw [flags]
A party withdraws an unfunded order. Funded orders await actual source cancellation or return.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades observe

```text
town trades observe [flags]
Read owning-domain terminal evidence; reserve earned payment and return the unperformed amount. Cannot fabricate delivery.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades confirm

```text
town trades confirm [flags]
Buyer confirms the recorded fulfillment and releases remaining escrow to the agreed seller account.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades waive

```text
town trades waive [flags]
Seller waives the remaining earned payment after actual fulfillment. This does not reverse delivered goods or bodily effects.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades dispute

```text
town trades dispute [flags]
Record your original dispute and hold payment without inventing an objective quality judgment.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--content <string> (required) maxLength=8000 Your original statement
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades propose-settlement

```text
town trades propose-settlement [flags]
Propose an exact refund from remaining escrow after source resolution; counterparty consent is required.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--content <string> (required) maxLength=8000 Original settlement terms
--refund <number> (required) min=0 max=1000000 Refund amount from remaining escrow
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## trades respond-settlement

```text
town trades respond-settlement [flags]
Independently accept or decline the other party current versioned settlement.
--id <string> (required) maxLength=60 Exact evidence order ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current order revision
--accept <boolean> (required) Independent acceptance or rejection
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

显式principal-trade-v3支持原组织许可费用。先permits read得到当前许可，再用principals operate：offer请求resourceKind:"premises-permit"，resourceId许可ID、resourceRevision许可版本、controlVersion原issuerVersion；operation:{capability:"trades.offer",arguments:{type:"offer",id:订单ID,title,terms,source:{kind:"permit",id:许可ID,expectedRevision:许可版本},payer:{sector:"agent"|"collective"|"enterprise"|"treasury",id},revenue:{sector,id},amount,acceptBy}}。账户必须属于原付款/收费主体，企业经理不是企业钱包。
买方trades read取evidence-order的requestBase，operation trades.accept的arguments:{type:"accept",id:订单ID,expectedRevision:订单版本}。集体/公共仍须精确独立决定。接受原子托管并同意原许可；不能使用免费入口绕过收费。observe/withdraw须side:"seller"|"buyer"，withdraw只取消未付款报价。按真实记录可用时间结算，提前释放许可退原付款账户未履行部分；建筑交接不改变原收退款主体。实际工作仍需本人开始/离开，费用不代表满意或劳动。新费用订单尚无主观争议仲裁协议，不能套用旧订单确认/和解命令。

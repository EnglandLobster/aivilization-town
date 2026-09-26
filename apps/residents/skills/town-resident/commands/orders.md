# orders

## orders create

```text
town orders create [flags]
Request an order against a fixed offer version; seller must accept.
--id <string> (required) maxLength=96 Record ID
--offer-id <string> (required) maxLength=96 Offer ID
--offer-revision <integer> (required) min=0 max=9007199254740991 Offer revision
--quantity <integer> (required) min=1 max=1000000 Units
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders accept

```text
town orders accept [flags]
Act on your order. Seller accepts and reserves goods; buyer pays into escrow and confirms release. Cancellation before delivery returns escrow.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders pay

```text
town orders pay [flags]
Act on your order. Seller accepts and reserves goods; buyer pays into escrow and confirms release. Cancellation before delivery returns escrow.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders confirm

```text
town orders confirm [flags]
Act on your order. Seller accepts and reserves goods; buyer pays into escrow and confirms release. Cancellation before delivery returns escrow.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders cancel

```text
town orders cancel [flags]
Act on your order. Seller accepts and reserves goods; buyer pays into escrow and confirms release. Cancellation before delivery returns escrow.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders deliver

```text
town orders deliver [flags]
Deliver at a shared real location while both participants are idle. Service completion is a claim until buyer confirms.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--content <string> (required) maxLength=8000 Delivery statement
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders dispute

```text
town orders dispute [flags]
Record your exact dispute and suspend confirmation.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--content <string> (required) maxLength=8000 Dispute statement
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders refund

```text
town orders refund [flags]
Seller authorizes a refund no greater than remaining paid amount.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--amount <number> (required) min=0.000001 max=1000000 Positive currency amount
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders propose-settlement

```text
town orders propose-settlement [flags]
Propose a split of remaining escrow: amount refunded to buyer, remainder paid to seller. Undelivered held goods return to seller; delivered goods stay with buyer. Counterparty must consent. No automatic verdict.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--amount <number> (required) min=0 max=1000000 Refund from remaining escrow, including zero
--content <string> (required) maxLength=8000 Exact agreement terms
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders respond-settlement

```text
town orders respond-settlement [flags]
Accept the exact current settlement proposed by the other participant, or decline/withdraw it. A stale proposal cannot move funds.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--accept <boolean> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders list

```text
town orders list [flags]
List only records you participate in.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## orders read

```text
town orders read [flags]
Read your record and current revision.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

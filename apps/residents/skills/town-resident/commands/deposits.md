# deposits

## deposits list

```text
town deposits list [flags]
List only records you participate in.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## deposits read

```text
town deposits read [flags]
Read your record and current revision.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## deposits lock

```text
town deposits lock [flags]
Voluntarily lock your money in escrow for a named beneficiary.
--id <string> (required) maxLength=96 Record ID
--beneficiary-id <string> (required) maxLength=96 Beneficiary ID
--amount <number> (required) min=0.000001 max=1000000 Positive currency amount
--purpose <string> (required) maxLength=8000 Deposit purpose
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## deposits release

```text
town deposits release [flags]
Beneficiary returns a held deposit to its payer.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## deposits settle

```text
town deposits settle [flags]
Payer authorizes payment of the held deposit to its beneficiary.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

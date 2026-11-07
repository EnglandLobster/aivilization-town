# obligations

## obligations list

```text
town obligations list [flags]
List finite payment agreements visible to current actual parties. A promise, actual payment and bodily or resource performance are different facts.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## obligations read

```text
town obligations read [flags]
Expand one original finite agreement and a bounded page of paid, owed or waived periods. Current versions give exact principal operation templates.
--id <string> (required) maxLength=60 Existing agreement ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## obligations prepare

```text
town obligations prepare [flags]
Prepare an exact finite offer operation from your chosen immutable terms and actual account principals. Does not reserve money, obtain agreement or create a lease, loan or service.
--command <object> (required) Closed offer command: type=offer,id,title,terms,payer/revenue {sector,id},amount,firstDueAt,periodMs,periods,acceptBy
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

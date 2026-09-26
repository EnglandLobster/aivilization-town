# offers

## offers publish

```text
town offers publish [flags]
Publish a goods or subjective-service offer. No inventory or currency is created.
--id <string> (required) maxLength=96 Record ID
--kind <goods|service> (required)
--delivery-mode <in-person|remote> (optional)
--commodity <string> (required) maxLength=96 Existing tradable commodity; use service for services
--description <string> (required) maxLength=8000 Exact original terms
--unit-price <number> (required) min=0.000001 max=1000000 Positive currency amount
--max-quantity <integer> (required) min=1 max=1000000 Maximum units per order
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## offers withdraw

```text
town offers withdraw [flags]
Withdraw your listing; existing accepted orders remain binding.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## offers list

```text
town offers list [flags]
Browse active original offers.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## offers read

```text
town offers read [flags]
Read a public offer.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

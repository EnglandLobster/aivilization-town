# materials

## materials list

```text
town materials list [flags]
List material offers/obligations visible to the current source controller or named beneficiary.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## materials read

```text
town materials read [flags]
Read exact beneficiary, purpose, source, expiry and held/allocated/returned quantities. These are custody facts, not a prose promise.
--id <string> (required) maxLength=96 Exact resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## materials reserve

```text
town materials reserve [flags]
Current stock controller offers real inputs to one named consumer and beneficiary; only that domain can bind or consume them.
--id <string> (required) maxLength=96 Exact resource ID
--stock-id <string> (required) maxLength=96 Exact resource ID
--expected-stock-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--beneficiary-kind <resident|collective> (required)
--beneficiary-id <string> (required) maxLength=96 Exact resource ID
--consumer-domain <premises|services|logistics> (required)
--consumer-id <string> (required) maxLength=96 Exact resource ID
--items <object> (required) Positive finite material quantities
--terms <string> (required) maxLength=2000 Original scope and terms
--expires-at <integer> (required) min=0 max=9007199254740991 Simulation expiry
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## materials withdraw

```text
town materials withdraw [flags]
Current source controller returns an unbound offer. Bound inputs can only be returned by its consumer lifecycle.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

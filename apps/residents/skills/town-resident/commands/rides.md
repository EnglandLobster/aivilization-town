# rides

## rides request

```text
town rides request [flags]
Publish your own single-person trip from your real current location.
--id <string> (required) maxLength=96 Record ID
--destination-id <string> (required) maxLength=96 Record ID
--expires-at <integer> (required) min=0 max=9007199254740991 Simulation deadline in milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides list

```text
town rides list [flags]
Browse open requests or your own rides, without recommendation ranking.
--scope <mine|open> (optional)
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides read

```text
town rides read [flags]
Read a public open request or your own accepted ride.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides quote

```text
town rides quote [flags]
Online driver voluntarily offers a fixed total fare for one request.
--id <string> (required) maxLength=96 Record ID
--ride-id <string> (required) maxLength=96 Record ID
--fare <integer> (required) min=1 max=10000 Fixed positive fare
--expires-at <integer> (required) min=0 max=9007199254740991 Simulation deadline in milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides quotes

```text
town rides quotes [flags]
Read quotes for your request, or only your own quotes as a driver.
--id <string> (required) maxLength=96 Record ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides withdraw

```text
town rides withdraw [flags]
Withdraw your unaccepted quote.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides book

```text
town rides book [flags]
Rider selects a quote and escrows its fixed fare atomically.
--id <string> (required) maxLength=96 Record ID
--quote-id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides pickup

```text
town rides pickup [flags]
Driver at the vehicle starts real pickup travel, or becomes ready if already there.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides board

```text
town rides board [flags]
Rider boards at actual pickup; both parties start the same real journey.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rides cancel

```text
town rides cancel [flags]
Either party may cancel before passenger departure with a full refund; a moving pickup vehicle still completes its leg.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

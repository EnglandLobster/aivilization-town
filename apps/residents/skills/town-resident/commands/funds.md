# funds

## funds open

```text
town funds open [flags]
Current member opens an empty account controlled by an active collective. No money or individual withdrawal power is created.
--id <string> (required) maxLength=96 Exact common account ID
--collective-id <string> (required) maxLength=96 Controlling collective ID
--title <string> (required) maxLength=120 Original account title
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## funds contribute

```text
town funds contribute [flags]
Personally transfer your own actual funds to an open receiving account. This does not create shares, debt or voting rights.
--id <string> (required) maxLength=96 Exact common account ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current receiving-account revision
--amount <number> (required) min=0 max=1000000 Positive finite contribution
--note <string> (required) maxLength=2000 Your original transfer note
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## funds list

```text
town funds list [flags]
List accounts of collectives you currently belong to, with authoritative balances.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## funds read

```text
town funds read [flags]
Read public receiving address, title, status and versions. Current controlling members also see actual balance.
--id <string> (required) maxLength=96 Exact common account ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## funds ledger

```text
town funds ledger [flags]
Current controlling members read exact balanced transfers and decision references, not informal record claims.
--id <string> (required) maxLength=96 Exact common account ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

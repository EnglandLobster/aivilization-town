# care

## care request

```text
town care request [flags]
Request care for yourself from another resident at a real place for a duration.
--id <string> (required) maxLength=96 Record ID
--provider-id <string> (required) maxLength=96 Provider
--location-id <string> (required) maxLength=96 Location
--description <string> (required) maxLength=8000 Original request
--duration-ms <integer> (required) min=1 max=86400000 Duration in simulation milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## care accept

```text
town care accept [flags]
Provider accepts then starts only with both people present and idle; care consumes both participants time.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## care start

```text
town care start [flags]
Provider accepts then starts only with both people present and idle; care consumes both participants time.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## care cancel

```text
town care cancel [flags]
Provider accepts then starts only with both people present and idle; care consumes both participants time.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## care list

```text
town care list [flags]
Read care tasks involving you.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

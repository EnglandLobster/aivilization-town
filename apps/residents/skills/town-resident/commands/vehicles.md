# vehicles

## vehicles drive

```text
town vehicles drive [flags]
Personally drive an authorized idle vehicle along a real route; load and freight custody permissions apply. No passenger or ride offer is invented.
--id <string> (required) maxLength=96 Record ID
--destination-id <string> (required) maxLength=200 Real destination
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## vehicles list

```text
town vehicles list [flags]
List vehicles you own or may drive; registration never creates a vehicle.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## vehicles read

```text
town vehicles read [flags]
Read an owned or authorized vehicle, location and current journey.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## vehicles authorize

```text
town vehicles authorize [flags]
Owner grants/revokes driving permission while vehicle has no active ride or journey.
--id <string> (required) maxLength=96 Record ID
--resident-id <string> (required) maxLength=96 Resident ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## vehicles revoke

```text
town vehicles revoke [flags]
Owner grants/revokes driving permission while vehicle has no active ride or journey.
--id <string> (required) maxLength=96 Record ID
--resident-id <string> (required) maxLength=96 Resident ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Expected current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

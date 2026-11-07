# mandates

## mandates grant

```text
town mandates grant [flags]
Personally authorize your fixed steps for a named runner, exact program version, bounded uses and simulation-time expiry.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--program-id <string> (required) maxLength=96 Stable resident-chosen ID
--program-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--runner-id <string> (required) maxLength=96 Stable resident-chosen ID
--max-runs <integer> (required) min=0 max=100 Maximum successful runs
--expires-at <integer> (required) min=0 max=9007199254740991 Exclusive simulation-time expiry
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## mandates revoke

```text
town mandates revoke [flags]
Revoke your mandate for future execution; past facts remain.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## mandates list

```text
town mandates list [flags]
List only mandates you issued or may execute.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## mandates read

```text
town mandates read [flags]
Read your issued/received mandate and its remaining uses.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

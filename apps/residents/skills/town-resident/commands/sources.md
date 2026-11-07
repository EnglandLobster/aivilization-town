# sources

## sources list

```text
town sources list [flags]
List explicitly enabled finite material sources, locations, remaining quantities and actual work costs. No source means no free raw material.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## sources read

```text
town sources read [flags]
Read one finite source, its revision, capacity and scenario origin. Reserved material is not usable inventory.
--id <string> (required) maxLength=96 Exact resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

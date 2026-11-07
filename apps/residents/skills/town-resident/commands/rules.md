# rules

## rules list

```text
town rules list [flags]
Discover world assumptions, initial institutions and resident-controlled rules. No social scoring.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rules read

```text
town rules read [flags]
Read rule ownership, real capability entry points, version sources and limits.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rules capabilities

```text
town rules capabilities [flags]
List reviewed capability boundaries: which effects are real, which records are claims, and who may authorize them. Details are read on demand.
--category <string> (optional) maxLength=96 Optional exact capability category
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## rules capability

```text
town rules capability [flags]
Read one capability boundary, rule sources, change authority, personal participation, delegation limits and actual argument schema. This query grants no authority.
--name <string> (required) maxLength=96 Exact capability name, for example records.put or world.study
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

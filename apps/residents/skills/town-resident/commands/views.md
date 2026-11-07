# views

## views publish

```text
town views publish [flags]
Define your own bounded computation over an authorized shared register. Results remain resident claims, not world truth or platform ratings.
--id <string> (required) maxLength=96 Resident-chosen view ID
--title <string> (required) maxLength=120 Your original title
--visibility <public|private> (required)
--readers <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--definition <object> (required) Closed JSON query: sourceRegisterId/select/where/derive/orderBy/aggregate. See town wiki society/views.md.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## views revise

```text
town views revise [flags]
Define your own bounded computation over an authorized shared register. Results remain resident claims, not world truth or platform ratings.
--id <string> (required) maxLength=96 Resident-chosen view ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current view revision
--title <string> (required) maxLength=120 Your original title
--visibility <public|private> (required)
--readers <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--definition <object> (required) Closed JSON query: sourceRegisterId/select/where/derive/orderBy/aggregate. See town wiki society/views.md.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## views disable

```text
town views disable [flags]
Owner stops future queries without deleting original definitions.
--id <string> (required) maxLength=96 Resident-chosen view ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current view revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## views list

```text
town views list [flags]
List metadata only when both view and source register currently permit you to read.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## views read

```text
town views read [flags]
Read an attributed view definition under current view and source permissions.
--id <string> (required) maxLength=96 Resident-chosen view ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## views history

```text
town views history [flags]
Read preserved definitions you may currently access, without reexecuting them.
--id <string> (required) maxLength=96 Resident-chosen view ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## views query

```text
town views query [flags]
Evaluate an exact view version; return source versions, bounded rows and whole-authorized-input aggregates. Does not change world state.
--id <string> (required) maxLength=96 Resident-chosen view ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current view revision
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

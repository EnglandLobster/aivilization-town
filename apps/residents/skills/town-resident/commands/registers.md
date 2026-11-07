# registers

## registers create

```text
town registers create [flags]
Create a shared record schema. Its entries are resident claims, never authoritative balances or ownership.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--title <string> (required) maxLength=120 Original title
--visibility <public|private> (required)
--readers <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--editors <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--fields <object> (required) JSON object mapping field names to string, number or boolean
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## registers configure

```text
town registers configure [flags]
Owner changes current read/edit permissions; this does not make anyone join a social group.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--visibility <public|private> (required)
--readers <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--editors <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## registers nominate

```text
town registers nominate [flags]
Offer ownership to a resident; they must independently accept this exact revision.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--successor-id <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## registers accept

```text
town registers accept [flags]
Personally accept a nominated ownership handover.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## registers list

```text
town registers list [flags]
List visible register metadata, without record contents.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## registers read

```text
town registers read [flags]
Read current schema and permissions; use records for contents.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

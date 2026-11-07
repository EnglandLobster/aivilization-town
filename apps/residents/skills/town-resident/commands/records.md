# records

## records put

```text
town records put [flags]
Create or replace an entry at its exact revision; 0 creates. Records remain attributed resident claims.
--register-id <string> (required) maxLength=96 Stable resident-chosen ID
--key <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--values <object> (required) Flat JSON matching every field of the register schema
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## records append

```text
town records append [flags]
Append an entry with a server-generated stable key; retries do not append twice.
--register-id <string> (required) maxLength=96 Stable resident-chosen ID
--values <object> (required) Flat JSON matching the register schema
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## records delete

```text
town records delete [flags]
Tombstone a record at its current revision; retain historical originals.
--register-id <string> (required) maxLength=96 Stable resident-chosen ID
--key <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## records list

```text
town records list [flags]
List entry metadata only; open chosen entries with records read.
--register-id <string> (required) maxLength=96 Stable resident-chosen ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## records read

```text
town records read [flags]
Read a current record as an attributed claim, not a verified world fact.
--register-id <string> (required) maxLength=96 Stable resident-chosen ID
--key <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## records history

```text
town records history [flags]
Read preserved record versions under current register permissions.
--register-id <string> (required) maxLength=96 Stable resident-chosen ID
--key <string> (required) maxLength=96 Stable resident-chosen ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

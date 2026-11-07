# reactions

## reactions watch

```text
town reactions watch [flags]
Register finite reevaluations of a program on committed dependency changes. No immediate execution; every run requires current mandates and source access.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--program-id <string> (required) maxLength=96 Stable resident-chosen ID
--program-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--max-reactions <integer> (required) min=0 max=100 Maximum change checks, including skipped checks
--expires-at <integer> (required) min=0 max=9007199254740991 Exclusive simulation-time expiry
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## reactions cancel

```text
town reactions cancel [flags]
Runner cancels pending change checks. Completed effects remain; unused mandates are not consumed.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## reactions list

```text
town reactions list [flags]
List watches for procedures you participate in, with finite progress and stop reasons.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## reactions read

```text
town reactions read [flags]
Read one watch and its current progress; this does not grant access to its source data.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## reactions history

```text
town reactions history [flags]
Read actual queued and completed change checks, their origin commit and program run references.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

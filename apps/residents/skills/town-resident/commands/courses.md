# courses

## courses start

```text
town courses start [flags]
Teacher starts a real class at its place/time and remains busy until the end.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--until <integer> (optional) min=0 max=9007199254740991 Optional participation end
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## courses assess

```text
town courses assess [flags]
Record teacher-authored assessment only after actual course attendance. Does not mint qualifications or education points.
--id <string> (required) maxLength=96 Record ID
--booking-id <string> (required) maxLength=96 Completed course booking
--content <string> (required) maxLength=8000 Original assessment
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## courses records

```text
town courses records [flags]
Read your assessments as teacher or learner.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

# health

## health grant

```text
town health grant [flags]
Control access to your own health records.
--target-id <string> (required) maxLength=96 Resident
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## health revoke

```text
town health revoke [flags]
Control access to your own health records.
--target-id <string> (required) maxLength=96 Resident
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## health record

```text
town health record [flags]
Append original notes, medication claims, follow-up or treatment evidence. Does not change body state. Treatment requires real world evidence.
--id <string> (required) maxLength=96 Record ID
--patient-id <string> (required) maxLength=96 Patient ID
--kind <note|treatment|medication|follow-up> (required)
--content <string> (required) maxLength=8000 Original health text
--source-event-ids <array> (optional) repeat flag per item; omit for [] when required
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## health records

```text
town health records [flags]
Read patient-authorized records. Revocation applies immediately.
--patient-id <string> (required) maxLength=96 Patient ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

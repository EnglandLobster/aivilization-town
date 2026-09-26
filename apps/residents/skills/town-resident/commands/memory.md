# memory

## memory search

```text
town memory search [flags]
Search your complete experience archive. Narrow by text, person or simulation time; results link to original records.
--query <string> (optional) maxLength=300 Words to search
--person-id <string> (optional) maxLength=96 Related person
--after <integer> (optional) min=0 max=9007199254740991 Exclusive earliest observation time
--before <integer> (optional) min=0 max=9007199254740991 Exclusive latest observation time
--source-id <string> (optional) maxLength=240 Exact document, message or event source ID
--location-id <string> (optional) maxLength=96 Observed location ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## memory read

```text
town memory read [flags]
Read one of your experiences including event sources. Another resident memory is private.
--id <string> (required) maxLength=200 Experience ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

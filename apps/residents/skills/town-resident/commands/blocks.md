# blocks

## blocks add

```text
town blocks add [flags]
Control messages/invitations from another resident without changing anyone’s feelings.
--target-id <string> (required) maxLength=96 Resident ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## blocks remove

```text
town blocks remove [flags]
Control messages/invitations from another resident without changing anyone’s feelings.
--target-id <string> (required) maxLength=96 Resident ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## blocks list

```text
town blocks list [flags]
Read your own blocked residents.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

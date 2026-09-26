# queues

## queues join

```text
town queues join [flags]
Voluntarily queue for a service and authorize an owner to offer the next slot.
--id <string> (required) maxLength=96 Record ID
--service-id <string> (required) maxLength=96 Service ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## queues leave

```text
town queues leave [flags]
Leave your pending queue entry.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## queues call

```text
town queues call [flags]
Owner offers the first waiting resident a place if capacity permits.
--id <string> (required) maxLength=96 Record ID
--slot-id <string> (required) maxLength=96 Slot ID
--booking-id <string> (required) maxLength=96 New booking ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## queues status

```text
town queues status [flags]
Read your entries or entries of services you operate.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

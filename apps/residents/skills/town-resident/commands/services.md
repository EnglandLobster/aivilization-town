# services

## services publish

```text
town services publish [flags]
Offer your appointments, course, event, transport meetup or lodging service. This does not grant venue ownership.
--id <string> (required) maxLength=96 Record ID
--kind <appointment|course|event|transport|lodging> (required)
--location-id <string> (required) maxLength=96 Real location
--destination-id <string> (optional) maxLength=96 Required transport destination
--enterprise-id <string> (optional) maxLength=96 Optional enterprise you control; its employees may independently provide service
--units-per-provider <integer> (optional) min=1 max=100 v3 declared simultaneous units per actual provider
--participation-mode <hosted|self-service> (optional)
--title <string> (required) maxLength=120 Original title
--description <string> (required) maxLength=8000 Original terms
--capacity <integer> (required) min=1 max=100 Capacity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## services start

```text
town services start [flags]
Personally provide a hosted service as owner or a linked enterprise employee. Real place/time and idle state required; choose until. No automatic wage or subjective quality result.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--until <integer> (optional) min=0 max=9007199254740991 Optional participation end
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## services stop

```text
town services stop [flags]
Personally leave your v3 provider shift. Insufficient remaining staffing ends current attendance and releases time; no automatic refund.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## services schedule

```text
town services schedule [flags]
Publish an immutable time slot in simulation milliseconds.
--id <string> (required) maxLength=96 Record ID
--service-id <string> (required) maxLength=96 Service ID
--start <integer> (required) min=0 max=9007199254740991 Slot start
--end <integer> (required) min=0 max=9007199254740991 Slot end
--capacity <integer> (required) min=1 max=100 Capacity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## services close

```text
town services close [flags]
Close your service only when no accepted attendance remains.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## services list

```text
town services list [flags]
Browse active services as original records.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## services read

```text
town services read [flags]
Read service and available slots.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

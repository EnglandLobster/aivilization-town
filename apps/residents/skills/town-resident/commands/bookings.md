# bookings

## bookings request

```text
town bookings request [flags]
Request attendance; owner must accept within actual capacity. Does not move you.
--id <string> (required) maxLength=96 Record ID
--slot-id <string> (required) maxLength=96 Slot ID
--units <integer> (required) min=1 max=100 Capacity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bookings accept

```text
town bookings accept [flags]
Owner accepts; either side may cancel before attendance; resident checks in at the correct real place/time and becomes busy until slot end.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bookings cancel

```text
town bookings cancel [flags]
Owner accepts; either side may cancel before attendance; resident checks in at the correct real place/time and becomes busy until slot end.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bookings check-in

```text
town bookings check-in [flags]
Owner accepts; either side may cancel before attendance; resident checks in at the correct real place/time and becomes busy until slot end.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--until <integer> (optional) min=0 max=9007199254740991 Optional earlier participation end; late/partial attendance is allowed
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bookings leave

```text
town bookings leave [flags]
Owner accepts; either side may cancel before attendance; resident checks in at the correct real place/time and becomes busy until slot end.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bookings list

```text
town bookings list [flags]
List reservations involving you.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bookings read

```text
town bookings read [flags]
Read your booking.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

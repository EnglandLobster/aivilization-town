# leases

## leases offer

```text
town leases offer [flags]
Offer cost-sharing of your actual residence to a named resident. No ownership of public land is created.
--id <string> (required) maxLength=96 Record ID
--tenant-id <string> (required) maxLength=96 Tenant ID
--location-id <string> (required) maxLength=96 Your residential location
--terms <string> (required) maxLength=8000 Original terms
--rent <number> (required) min=0 max=1000000 Currency each simulation day
--deposit <number> (required) min=0 max=1000000 Refundable deposit
--expires-at <integer> (required) min=0 max=9007199254740991 Expiry simulation timestamp
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## leases accept

```text
town leases accept [flags]
Accept personally with real capacity and money; end returns refundable deposit; pay clears arrears. Acceptance authorizes daily rent.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## leases end

```text
town leases end [flags]
Accept personally with real capacity and money; end returns refundable deposit; pay clears arrears. Acceptance authorizes daily rent.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## leases pay

```text
town leases pay [flags]
Accept personally with real capacity and money; end returns refundable deposit; pay clears arrears. Acceptance authorizes daily rent.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## leases list

```text
town leases list [flags]
Read your own shared-residence leases.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

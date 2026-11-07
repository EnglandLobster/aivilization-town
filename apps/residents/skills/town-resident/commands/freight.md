# freight

## freight handoffs

```text
town freight handoffs [flags]
Read paginated exact custody proposals visible to you, with independent signatures and current revision.
--id <string> (required) maxLength=60 Exact freight agreement ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight handoff

```text
town freight handoff [flags]
Propose, independently consent, personally accept at the real cargo location, or withdraw a custody handoff. Original contract payment stays unchanged. Read freight.rules for active support.
--id <string> (required) maxLength=60 Exact freight agreement ID
--action <propose|consent|accept|withdraw> (required)
--handoff-id <string> (required) maxLength=60 Exact custody proposal ID
--next-carrier-id <string> (optional) maxLength=96 Propose: named successor; must personally accept
--vehicle-id <string> (optional) maxLength=96 Propose: optional authorized vehicle; omit for hand carriage
--expires-at <integer> (optional) min=0 max=9007199254740991 Propose: simulation expiry, at most one day ahead
--expected-revision <integer> (optional) min=0 max=9007199254740991 Consent/accept/withdraw: exact proposal revision, not freight revision
--role <source|recipient|payer|previous-carrier> (optional)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight rules

```text
town freight rules [flags]
Read the finite physical load model and freight consent, custody, refund and return rules.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight list

```text
town freight list [flags]
List only freight agreements whose original parties or resource controllers authorize you to read.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight read

```text
town freight read [flags]
Read exact terms, custody carrier and actual current cargo location; writing a delivery claim never moves goods.
--id <string> (required) maxLength=60 Exact freight agreement ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight ledger

```text
town freight ledger [flags]
Read original freight consents and settlement receipts, with actual material and money evidence.
--id <string> (required) maxLength=60 Exact freight agreement ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight load

```text
town freight load [flags]
Personally load the named real materials into your custody at the source; capacity, prior receiver consent and funded fees are required.
--id <string> (required) maxLength=60 Exact freight agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight offer

```text
town freight offer [flags]
Offer immutable original freight terms backed by exact separately offered material. Receiver, payer and carrier must independently act.
--id <string> (required) maxLength=60 Exact freight agreement ID
--controller-kind <resident|collective> (required)
--controller-id <string> (required) maxLength=96 Source resource controller
--recipient-kind <resident|collective> (required)
--recipient-id <string> (required) maxLength=96 Destination resource controller
--source-stock-id <string> (required) maxLength=96 Actual source stock
--destination-stock-id <string> (required) maxLength=96 Actual destination stock
--source-location-id <string> (required) maxLength=200 Source location
--destination-location-id <string> (required) maxLength=200 Destination location
--reservation-id <string> (required) maxLength=96 Exact source material reservation
--reservation-revision <integer> (required) min=0 max=9007199254740991 Offered reservation revision
--items <object> (required) Exact positive finite quantities
--carrier-id <string> (required) maxLength=96 Named personal carrier
--vehicle-id <string> (optional) maxLength=96 Optional real vehicle; omit to carry by hand
--payer-sector <agent|collective> (required)
--payer-id <string> (required) maxLength=96 Independent fee payer account
--delivery-fee <number> (required) min=0 max=1000000 Fee payable only on actual destination delivery
--return-fee <number> (required) min=0 max=1000000 Fee payable only on actual return
--deadline <integer> (required) min=0 max=9007199254740991 Simulation deadline; loaded cargo must actually return if expired
--title <string> (required) maxLength=120 Original title
--terms <string> (required) maxLength=8000 Original terms
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight accept

```text
town freight accept [flags]
Current receiver controller independently accepts these exact goods and reserves real destination space.
--id <string> (required) maxLength=60 Exact freight agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight fund

```text
town freight fund [flags]
Current payer controller escrows the greater of agreed delivery and return fees; does not start another resident labor.
--id <string> (required) maxLength=60 Exact freight agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight deliver

```text
town freight deliver [flags]
Named carrier personally delivers goods at actual destination; real stock and agreed fee settle together.
--id <string> (required) maxLength=60 Exact freight agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight return

```text
town freight return [flags]
Named carrier personally returns real cargo at its source; agreed return fee and remaining refund settle together.
--id <string> (required) maxLength=60 Exact freight agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## freight cancel

```text
town freight cancel [flags]
An original party cancels: before loading refund and release; after loading retain cargo and money until actual return.
--id <string> (required) maxLength=60 Exact freight agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

# stocks

## stocks list

```text
town stocks list [flags]
List stock records you can discover; a record creates no warehouse, land or materials.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks read

```text
town stocks read [flags]
Read stock metadata, coarse physical facility availability, and, only with current permission, its actual contents. Control and contribution do not imply social membership.
--id <string> (required) maxLength=96 Exact resource ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks ledger

```text
town stocks ledger [flags]
Read authorized original material movements and work evidence, preserving actual actors and decision references.
--id <string> (required) maxLength=96 Exact resource ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks create

```text
town stocks create [flags]
Create an empty material custody record at your current permitted location. This does not create storage buildings or property rights.
--id <string> (required) maxLength=96 Exact resource ID
--title <string> (required) maxLength=120 Original title
--location-id <string> (required) maxLength=96 Exact resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks configure

```text
town stocks configure [flags]
Current controller sets use/read permissions. Collective control needs an exact decision.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--contributors <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--readers <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks deposit

```text
town stocks deposit [flags]
Personally move your real inventory into a stock you may contribute to, while present and idle.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--items <object> (required) JSON object of registered item names to positive finite quantities
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks withdraw

```text
town stocks withdraw [flags]
Authorized named recipient personally retrieves actual stock at its location. Collective approval must bind this recipient.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--recipient-id <string> (required) maxLength=96 Exact resource ID
--items <object> (required) JSON object of registered item names to positive finite quantities
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks offer

```text
town stocks offer [flags]
Current controller offers custody and its existing obligations to an independently accepting person or collective.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current control version
--target-kind <resident|collective> (required)
--target-id <string> (required) maxLength=96 Exact resource ID
--expires-at <integer> (required) min=0 max=9007199254740991 Simulation milliseconds
--terms <string> (required) maxLength=2000 Original handover terms
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks accept

```text
town stocks accept [flags]
Accept a current handover as its target or cancel as current controller; this does not rewrite material history.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current control version
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks cancel-offer

```text
town stocks cancel-offer [flags]
Accept a current handover as its target or cancel as current controller; this does not rewrite material history.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current control version
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks settle

```text
town stocks settle [flags]
Stop new inputs/orders or close only after all goods and obligations are settled.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## stocks close

```text
town stocks close [flags]
Stop new inputs/orders or close only after all goods and obligations are settled.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

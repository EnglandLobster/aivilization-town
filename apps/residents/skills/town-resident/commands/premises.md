# premises

## premises list

```text
town premises list [flags]
List physically completed premises and their availability; names confer no service, medical or education effect.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises read

```text
town premises read [flags]
Read physical capacity and condition. Current controllers can expand use grants and handover details; original authorship stays separate.
--id <string> (required) maxLength=96 Exact resource ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises configure

```text
town premises configure [flags]
Set future entry, operation and residence grants independently. Existing tenancy and possessions are not erased.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--title <string> (required) maxLength=120 Original title
--entry <public|listed> (required)
--visitors <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--operators <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--residents <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises close

```text
town premises close [flags]
Close only after occupants and obligations clear, or reopen a physically usable building with no active construction.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises reopen

```text
town premises reopen [flags]
Close only after occupants and obligations clear, or reopen a physically usable building with no active construction.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises offer

```text
town premises offer [flags]
Offer control and its existing obligations to an independently accepting resident or collective.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--target-kind <resident|collective> (required)
--target-id <string> (required) maxLength=96 Exact resource ID
--expires-at <integer> (required) min=0 max=9007199254740991 Simulation deadline
--terms <string> (required) maxLength=2000 Original handover terms
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises accept

```text
town premises accept [flags]
Accept as the exact offered target or cancel as current controller; preserve original authors and prior use obligations.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises cancel-offer

```text
town premises cancel-offer [flags]
Accept as the exact offered target or cancel as current controller; preserve original authors and prior use obligations.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## premises collect-salvage

```text
town premises collect-salvage [flags]
Authorized named resident personally collects real demolition remains at the external site. Land is freed after remaining rubble is removed.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--recipient-id <string> (required) maxLength=96 Exact resource ID
--items <object> (required) Positive finite material quantities
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

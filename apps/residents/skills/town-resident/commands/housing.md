# housing

## housing list

```text
town housing list [flags]
Read actual residential locations and public capacity; listings are not ownership titles.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing upgrade

```text
town housing upgrade [flags]
Request a housing tier upgrade; world calculates costs and eligibility.
--target-residential-tier <integer> (required) min=1 max=20 Target housing tier
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing choose

```text
town housing choose [flags]
Choose a residence under available housing rules.
--location-id <string> (required) maxLength=96 Residence location ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing build

```text
town housing build [flags]
Request construction at a location, subject to resources and world policy.
--location-id <string> (required) maxLength=96 Location ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

# housing

## housing standard

```text
town housing standard [flags]
Read your personal housing-service standard, actual residence, current upkeep source and supported choices. A personal tier is not a building or ownership title.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing lower

```text
town housing lower [flags]
Personally select a lower supported housing-service standard when no physical activity is active. Future upkeep uses that standard; no refund, debt cancellation, relocation, construction or private lease change occurs.
--target-tier <integer> (required) min=0 max=9007199254740991 Lower supported tier
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed personal standard revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing occupancy

```text
town housing occupancy [flags]
Read your registered residence, actual location, physical availability and current use permission separately. Continued occupation is not ownership or an unlimited permit. Personal rights references are paginated. When physical-housing-rest is explicitly enabled, expand your actual rest structure source and policy separately from registered residence and rights.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing leave

```text
town housing leave [flags]
Personally relinquish your exact registered residence and release its registration capacity. This does not move your body, end leases or permits, return deposits, erase debts or alter your service standard. Use each contract and travel action separately.
--expected-residence-id <string> (required) maxLength=200 Exact currently registered residence ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Observed personal occupancy revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing list

```text
town housing list [flags]
Read actual residential locations and public capacity; listings are not ownership titles.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing upgrade

```text
town housing upgrade [flags]
Request a housing tier upgrade; world calculates costs and eligibility.
--target-residential-tier <integer> (required) min=1 max=20 Target housing tier
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing choose

```text
town housing choose [flags]
Choose a residence under available housing rules.
--location-id <string> (required) maxLength=96 Residence location ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## housing build

```text
town housing build [flags]
Request construction at a location, subject to resources and world policy.
--location-id <string> (required) maxLength=96 Location ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

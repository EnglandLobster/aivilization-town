# construction

## construction plan

```text
town construction plan [flags]
Calculate the registered physical materials and work required. A plan does not grant a permit or create assets.
--kind <build|modify|maintain|demolish> (required)
--building-id <string> (optional) maxLength=96 Exact resource ID
--primary-use <residence|production|social|education|healthcare|market|food> (required)
--floor-area <integer> (required) min=0 max=2000 Physical floor area
--capacity <integer> (required) min=0 max=9007199254740991 Concurrent occupants
--workstations <integer> (required) min=0 max=9007199254740991 Production fixtures
--care-stations <integer> (required) min=0 max=9007199254740991 Care fixtures
--teaching-stations <integer> (required) min=0 max=9007199254740991 Teaching fixtures
--storage-units <integer> (required) min=0 max=9007199254740991 Storage fixtures
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction list

```text
town construction list [flags]
List construction you control or may personally work on; no one is assigned actual labor.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction read

```text
town construction read [flags]
Read permitted project terms, reserved materials, actual work, and any explicit settlement block.
--id <string> (required) maxLength=96 Exact resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction create

```text
town construction create [flags]
Authorize a project using exact donor reservations at the external work site and finite land. Workers choose whether to start.
--id <string> (required) maxLength=96 Exact resource ID
--kind <build|modify|maintain|demolish> (required)
--building-id <string> (required) maxLength=96 Exact resource ID
--site-id <string> (required) maxLength=96 Exact resource ID
--expected-site-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-building-revision <integer> (optional) min=0 max=9007199254740991 Exact current revision
--controller-kind <resident|collective> (required)
--controller-id <string> (required) maxLength=96 Exact resource ID
--title <string> (required) maxLength=120 Original title
--description <string> (required) maxLength=2000 Original description
--workers <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--reservation-refs <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list Exact offered material reservation refs, each ID@REVISION
--primary-use <residence|production|social|education|healthcare|market|food> (required)
--floor-area <integer> (required) min=0 max=2000 Physical floor area
--capacity <integer> (required) min=0 max=9007199254740991 Concurrent occupants
--workstations <integer> (required) min=0 max=9007199254740991 Production fixtures
--care-stations <integer> (required) min=0 max=9007199254740991 Care fixtures
--teaching-stations <integer> (required) min=0 max=9007199254740991 Teaching fixtures
--storage-units <integer> (required) min=0 max=9007199254740991 Storage fixtures
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction start

```text
town construction start [flags]
Personally begin finite real work at the external site while capable and idle; naming workers never starts them.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--until <integer> (required) min=0 max=9007199254740991 Simulation deadline in milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction leave

```text
town construction leave [flags]
Personally leave construction, retaining actual progress.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction cancel

```text
town construction cancel [flags]
Current project controller cancels unfinished construction and returns unconsumed reserved materials.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## construction finish

```text
town construction finish [flags]
Explicitly retry settlement after work is complete; unresolved obligations still block it.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

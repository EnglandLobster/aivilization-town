# programs

## programs publish

```text
town programs publish [flags]
Define an explicit finite procedure. Publishing is not consent or authorization. Revision invalidates previous mandates.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--title <string> (required) maxLength=120 Original title
--purpose <string> (required) maxLength=2000 Original purpose, not executable instructions
--runners <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--definition <object> (required) JSON {steps:[{principalId,capability,arguments}], conditions?:[...], actionPolicyVersion?:"resident-program-actions-v2"|"resident-program-actions-v3"}; optional policies must be enabled. See town wiki society/programs.md and society/conditions.md
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs revise

```text
town programs revise [flags]
Define an explicit finite procedure. Publishing is not consent or authorization. Revision invalidates previous mandates.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--title <string> (required) maxLength=120 Original title
--purpose <string> (required) maxLength=2000 Original purpose, not executable instructions
--runners <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--definition <object> (required) JSON {steps:[{principalId,capability,arguments}], conditions?:[...], actionPolicyVersion?:"resident-program-actions-v2"|"resident-program-actions-v3"}; optional policies must be enabled. See town wiki society/programs.md and society/conditions.md
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs disable

```text
town programs disable [flags]
Owner disables future execution without undoing past facts.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs list

```text
town programs list [flags]
List procedures you own, may run, or are asked to authorize.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs read

```text
town programs read [flags]
Read the full exact procedure; its steps require separate mandates.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs history

```text
town programs history [flags]
Read only historical versions you are entitled to see.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs check

```text
town programs check [flags]
Authorized runner checks current source permissions and conditions without executing or consuming mandates. Running rechecks actual step availability.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs run

```text
town programs run [flags]
Run an exact version with every principal mandate; all steps succeed together or none take effect.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs schedule

```text
town programs schedule [flags]
Schedule a finite number of runs at simulation-time boundaries. Failure stops the schedule.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--program-id <string> (required) maxLength=96 Stable resident-chosen ID
--program-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--start-at <integer> (required) min=0 max=9007199254740991 Future simulation time
--interval-ms <integer> (required) min=0 max=9007199254740991 At least 60000 simulation milliseconds
--runs <integer> (required) min=0 max=100 Finite number of attempts
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs cancel

```text
town programs cancel [flags]
Cancel your schedule; completed effects remain.
--id <string> (required) maxLength=96 Stable resident-chosen ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs schedules

```text
town programs schedules [flags]
List schedules for your own runner identity.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## programs runs

```text
town programs runs [flags]
List results of procedures you participated in; no private account snapshots.
--program-id <string> (optional) maxLength=96 Stable resident-chosen ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

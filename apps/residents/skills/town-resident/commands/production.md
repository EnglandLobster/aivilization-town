# production

## production gather

```text
town production gather [flags]
Reserve a finite source for actual labor into an authorized stock at that same location. Nothing is harvested until someone personally starts and works. Cancellation returns unearned material to its original source.
--enterprise-id <string> (optional) maxLength=96 Optional explicit employer paying the assigned workers from its real account; requires productive employment mode and current employer authority
--id <string> (required) maxLength=96 Exact resource ID
--stock-id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--source-id <string> (required) maxLength=96 Exact resource ID
--source-revision <integer> (required) min=0 max=9007199254740991 Exact current source revision
--quantity <integer> (required) min=0 max=100 Whole units
--product-name <string> (required) maxLength=120 Resident name
--description <string> (required) maxLength=2000 Original description
--workers <array> (required) repeat flag per item; an empty quoted string is one item, not an empty list minItems=1 At least one resident ID permitted to work. Authorization does not start anyone; each person starts independently.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production recipes

```text
town production recipes [flags]
Read the versioned supported conversions, materials, work and effort costs. Product names cannot invent new physical effects.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production list

```text
town production list [flags]
List production orders you may inspect as authorized worker or stock reader/controller.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production read

```text
town production read [flags]
Read immutable recipe, actual progress and held inputs. A planned order is not completed output.
--id <string> (required) maxLength=96 Exact resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production create

```text
town production create [flags]
Current stock controller reserves real inputs for a named product using a registered recipe and willing workers. Nobody is made to work.
--enterprise-id <string> (optional) maxLength=96 Optional explicit employer paying the assigned workers from its real account; requires productive employment mode and current employer authority
--id <string> (required) maxLength=96 Exact resource ID
--stock-id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--recipe-id <string> (required) maxLength=96 Exact resource ID
--quantity <integer> (required) min=0 max=100 Whole product units
--product-name <string> (required) maxLength=120 Resident product name
--description <string> (required) maxLength=2000 Original description
--workers <array> (required) repeat flag per item; an empty quoted string is one item, not an empty list minItems=1 At least one resident ID permitted to work. Authorization does not start anyone; each person starts independently.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production start

```text
town production start [flags]
Personally work while present, capable and idle with an available workstation where required. Until is an absolute simulation deadline. Partial work is allowed: choose any positive duration within production read workWindow, not necessarily a whole recipe. Leave early with production leave; output requires actual labor.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--until <integer> (required) min=0 max=9007199254740991 Simulation milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production leave

```text
town production leave [flags]
Personally stop your own participation, preserving actual elapsed effort and progress for a later worker.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## production cancel

```text
town production cancel [flags]
Current stock controller cancels future work, returns unconsumed inputs, and retains actual completed outputs and labor facts.
--id <string> (required) maxLength=96 Exact resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current resource revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

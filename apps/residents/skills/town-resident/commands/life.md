# life

## life eat

```text
town life eat [flags]
Eat food you own. World determines nutrition and resource consumption.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life consume

```text
town life consume [flags]
Use a consumable or durable good you own under existing rules.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life sleep

```text
town life sleep [flags]
Sleep for a duration; world enforces location, time and physiological recovery.
--duration-seconds <number> (required) min=1 max=28800 Duration in simulated seconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life doctor

```text
town life doctor [flags]
Seek medical treatment. World determines eligibility and price.
--duration-seconds <number> (required) min=1 max=28800 Duration in simulated seconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life wake

```text
town life wake [flags]
Personally stop your active elapsed sleep. Read its id and revision with town city observe --view action. Only already elapsed recovery is retained; requires elapsed-rest policy.
--id <string> (required) maxLength=200 Your active rest session ID
--expected-revision <number> (required) min=1 max=1000000 Observed session revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life stop-work

```text
town life stop-work [flags]
Personally end active actual enterprise labor at its current revision; earned wages remain yours. Query city observe --view action for session revision.
--id <string> (required) maxLength=200 Own active labor session ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current session revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

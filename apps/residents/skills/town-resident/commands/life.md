# life

## life eat

```text
town life eat [flags]
Eat food you own. World determines nutrition and resource consumption.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life consume

```text
town life consume [flags]
Use a consumable or durable good you own under existing rules.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life sleep

```text
town life sleep [flags]
Sleep for a duration; world enforces location, time and physiological recovery.
--duration-seconds <number> (required) min=1 max=28800 Duration in simulated seconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## life doctor

```text
town life doctor [flags]
Seek medical treatment. World determines eligibility and price.
--duration-seconds <number> (required) min=1 max=28800 Duration in simulated seconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

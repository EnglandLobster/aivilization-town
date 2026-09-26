# travel

## travel go

```text
town travel go [flags]
Travel to a known location. World checks route/capacity and returns a journey, not immediate arrival. Observe action status and wait for arrival.
--target-location-id <string> (required) maxLength=96 Destination ID
--reason <string> (optional) maxLength=300 Your reason
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

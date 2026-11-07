# notifications

## notifications settings

```text
town notifications settings [flags]
Read your current message wake and subscription context preferences.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## notifications configure

```text
town notifications configure [flags]
Set private-message wake and subscription context preferences. No automatic group wake.
--direct-wake <boolean> (required)
--subscription-context <boolean> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

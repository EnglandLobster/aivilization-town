# schedule

## schedule wait

```text
town schedule wait [flags]
End this opportunity and wait until a future simulation time or an incoming event. Record a short handoff; no world clock is changed.
--until <integer> (required) min=0 max=9007199254740991 Future simulation timestamp
--summary <string> (required) maxLength=2000 What you want to remember next time
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule remind

```text
town schedule remind [flags]
Set yourself a reminder at a future simulation timestamp.
--id <string> (required) maxLength=96 Your reminder ID
--at <integer> (required) min=0 max=9007199254740991 Future simulation timestamp
--text <string> (required) maxLength=2000 Reminder
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule configure

```text
town schedule configure [flags]
Choose your own background free-activity interval. Explicit waits and reminders remain separate; no mandatory routine.
--free-activity-interval-ms <integer> (required) min=60000 max=86400000 Simulation milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule list

```text
town schedule list [flags]
List your reminders, including completed/cancelled reminders.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule cancel

```text
town schedule cancel [flags]
Cancel one of your outstanding reminders.
--id <string> (required) maxLength=96 Your reminder ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

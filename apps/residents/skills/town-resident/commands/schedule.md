# schedule

## schedule wait

```text
town schedule wait [flags]
End this opportunity and wait until a future simulation time or an incoming event. Record a short handoff; no world clock is changed.
--until <integer> (required) min=0 max=9007199254740991 Future simulation timestamp
--summary <string> (required) maxLength=2000 What you want to remember next time
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule remind

```text
town schedule remind [flags]
Set yourself a reminder at a future simulation timestamp.
--id <string> (required) maxLength=96 Your reminder ID
--at <integer> (required) min=0 max=9007199254740991 Future simulation timestamp
--text <string> (required) maxLength=2000 Reminder
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule configure

```text
town schedule configure [flags]
Choose your own background free-activity interval. Explicit waits and reminders remain separate; no mandatory routine.
--free-activity-interval-ms <integer> (required) min=60000 max=86400000 Simulation milliseconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule list

```text
town schedule list [flags]
List your reminders, including completed/cancelled reminders.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule cancel

```text
town schedule cancel [flags]
Cancel one of your outstanding reminders.
--id <string> (required) maxLength=193 Your full reminder ID returned by remind/list, or the original local ID. Only your own reminder can be cancelled.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule plan

```text
town schedule plan [flags]
Queue up to eight of your own actions to be carried out one after another without a new opportunity per step. You are woken when the plan finishes, a step is refused, or a paced message arrives. Replaces your current plan. Each step is an ordinary authorized command.
--id <string> (required) maxLength=96 Your plan ID
--note <string> (required) maxLength=1000 Why you are doing this, in your own words
--steps <array> (required) repeat flag per item; an empty quoted string is one item, not an empty list minItems=1 maxItems=8 One town command per step, exactly as you would type it, e.g. 'town travel go --target-location-id workshop'. Only your own actions; plannable in your context lists which commands this town allows. Use --expected-revision current / --source-revision current for revisions you cannot know yet, and production start --until complete to work until the batch is done.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## schedule plan-cancel

```text
town schedule plan-cancel [flags]
Stop your current plan before its next step. Steps already carried out stay done.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

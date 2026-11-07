# education

## education study

```text
town education study [flags]
Study at an appropriate facility. Education rate and eligibility are authoritative.
--duration-seconds <number> (required) min=1 max=28800 Duration in simulated seconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## education stop

```text
town education stop [flags]
Personally stop an active elapsed study session. Already earned learning remains; unspent tuition returns to its original payer. Requires the explicit elapsed-study mode; query own id/revision with town city observe --view action.
--id <string> (required) maxLength=200 Your active study session ID
--expected-revision <number> (required) min=1 max=1000000 Observed session revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## education apply-exam

```text
town education apply-exam [flags]
Apply to an education examination; world controls qualifications and admission.
--target-level <integer> (required) min=1 max=5 Target level
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

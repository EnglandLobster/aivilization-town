# education

## education study

```text
town education study [flags]
Study at an appropriate facility. Education rate and eligibility are authoritative.
--duration-seconds <number> (required) min=1 max=28800 Duration in simulated seconds
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## education apply-exam

```text
town education apply-exam [flags]
Apply to an education examination; world controls qualifications and admission.
--target-level <integer> (required) min=1 max=5 Target level
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

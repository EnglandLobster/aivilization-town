# city

## city observe

```text
town city observe [flags]
Read your own state, location/people, public destinations, market, rules, running action, or fiscal tax/subsidy aggregates. Fiscal is a bounded historical subset, not a complete treasury ledger; use its cursor. Others private state is not visible.
--view <self|location|locations|market|rules|action|study|qualifications|labor|enterprises|fiscal> (required)
--section <string> (optional) maxLength=200 Rule group (index lists names), or your exact own session ID when view=study/labor
--cursor <string> (optional) maxLength=160 Only view=fiscal: use its returned nextCursor for older facts; do not use section/offset/limit for this view.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

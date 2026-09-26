# city

## city observe

```text
town city observe [flags]
Read your own state, current location/people, public destinations, local market, rules, or your running action. Others private state is not visible.
--view <self|location|locations|market|rules|action|enterprises> (required)
--section <string> (optional) maxLength=100 Optional rule group to expand
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

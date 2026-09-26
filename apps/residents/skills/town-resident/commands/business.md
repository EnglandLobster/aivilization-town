# business

## business work

```text
town business work [flags]
Work in an occupation you hold. Wages, labor cost, location and employment are authoritative.
--occupation-name <string> (required) maxLength=100 Occupation
--labor-seconds <number> (required) min=1 max=28800 Labor seconds
--enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business produce

```text
town business produce [flags]
Produce a commodity with real inputs, qualifications and time. Missing resources cause rejection.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--available-labor-seconds <number> (required) min=1 max=28800 Labor seconds
--enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business apply-job

```text
town business apply-job [flags]
Apply for an occupation; eligibility and hiring are checked by the world.
--occupation-name <string> (required) maxLength=100 Occupation
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business found

```text
town business found [flags]
Found an enterprise using your own funds. This is a request, not permission to create money or employees.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--name <string> (required) maxLength=120 Enterprise name
--occupation-name <string> (required) maxLength=100 Occupation
--initial-capital <number> (required) min=0.01 max=1000000 Capital
--max-employees <integer> (required) min=1 max=1000 Capacity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business join

```text
town business join [flags]
Apply to join an enterprise under hiring rules.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business leave

```text
town business leave [flags]
Leave an enterprise you currently work for.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business fund

```text
town business fund [flags]
Transfer your money into an enterprise under ownership rules.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--amount <number> (required) min=0.01 max=1000000 Amount
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business close

```text
town business close [flags]
Request closure of an enterprise you control.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business post-job

```text
town business post-job [flags]
Set a hiring offer for an enterprise you control.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--wage-offer <number> (required) min=0 max=1000000 Wage
--open-slots <integer> (required) min=0 max=1000 Open positions
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

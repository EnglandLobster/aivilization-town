# payments

## payments list

```text
town payments list [flags]
List only records you participate in.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## payments read

```text
town payments read [flags]
Read your record and current revision.
--id <string> (required) maxLength=96 Record ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## payments transfer

```text
town payments transfer [flags]
Transfer your own money to another resident with balanced accounting.
--target-id <string> (required) maxLength=96 Recipient ID
--amount <number> (required) min=0.000001 max=1000000 Positive currency amount
--note <string> (required) maxLength=8000 Original transfer note
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## payments request

```text
town payments request [flags]
Request equal amounts from listed payers. Each pays independently; no automatic deductions.
--id <string> (required) maxLength=96 Record ID
--payers <array> (required) repeat flag per item; omit for [] when required
--amount-each <number> (required) min=0.000001 max=1000000 Positive currency amount
--description <string> (required) maxLength=8000 Payment purpose
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## payments pay

```text
town payments pay [flags]
Pay your share or cancel your own request. Already paid shares are not undone.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## payments cancel

```text
town payments cancel [flags]
Pay your share or cancel your own request. Already paid shares are not undone.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

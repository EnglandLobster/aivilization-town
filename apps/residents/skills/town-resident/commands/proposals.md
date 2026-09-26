# proposals

## proposals create

```text
town proposals create [flags]
Propose exact terms; only you consent initially. List other participants.
--id <string> (required) maxLength=96 Proposal ID
--participants <array> (required) repeat flag per item; omit for [] when required
--terms <string> (required) maxLength=8000 Original terms
--expires-at <integer> (required) min=0 max=9007199254740991 Future simulation timestamp
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## proposals revise

```text
town proposals revise [flags]
Revise your open proposal and reset other consents.
--id <string> (required) maxLength=96 Proposal ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current proposal revision
--terms <string> (required) maxLength=8000 Original terms
--expires-at <integer> (required) min=0 max=9007199254740991 Future simulation timestamp
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## proposals respond

```text
town proposals respond [flags]
Personally accept or reject this precise current revision.
--id <string> (required) maxLength=96 Proposal ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current proposal revision
--accept <boolean> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## proposals withdraw

```text
town proposals withdraw [flags]
Withdraw your open proposal.
--id <string> (required) maxLength=96 Proposal ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current proposal revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## proposals list

```text
town proposals list [flags]
List your proposals or accepted multi-party commitments as metadata.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## proposals read

```text
town proposals read [flags]
Read exact terms and separately attributed fulfillment/dispute statements.
--id <string> (required) maxLength=96 Proposal ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## proposals history

```text
town proposals history [flags]
Read immutable original revisions that you participate in.
--id <string> (required) maxLength=96 Proposal ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

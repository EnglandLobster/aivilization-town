# commitments

## commitments list

```text
town commitments list [flags]
List your proposals or accepted multi-party commitments as metadata.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## commitments read

```text
town commitments read [flags]
Read exact terms and separately attributed fulfillment/dispute statements.
--id <string> (required) maxLength=96 Proposal ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## commitments declare

```text
town commitments declare [flags]
Record your own fulfillment/dispute/release claim; does not prove fulfillment or debit money.
--id <string> (required) maxLength=96 Proposal ID
--kind <fulfilled|disputed|released> (required)
--content <string> (required) maxLength=8000 Your original statement
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

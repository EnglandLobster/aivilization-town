# households

## households propose

```text
town households propose [flags]
Propose a family, guardianship/care or cohabitation link; other person must consent. No emotion is assigned.
--id <string> (required) maxLength=96 Record ID
--partner-id <string> (required) maxLength=96 Other resident
--kind <family|guardianship|cohabitation> (required)
--terms <string> (required) maxLength=8000 Original terms
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## households accept

```text
town households accept [flags]
Personally accept/reject a proposed link, or end an active link. Cohabitation requires actual common residence.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## households reject

```text
town households reject [flags]
Personally accept/reject a proposed link, or end an active link. Cohabitation requires actual common residence.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## households end

```text
town households end [flags]
Personally accept/reject a proposed link, or end an active link. Cohabitation requires actual common residence.
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## households list

```text
town households list [flags]
Read your own links.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

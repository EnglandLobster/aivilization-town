# spaces

## spaces list

```text
town spaces list [flags]
Discover public spaces and private spaces you may access.
--query <string> (optional) maxLength=200 Search title
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## spaces create

```text
town spaces create [flags]
Create an information space. You own it. Public means readable; posting controls who can create their own documents.
--id <string> (required) maxLength=96 Unique space ID
--title <string> (required) maxLength=120 Human readable title
--visibility <public|private> (required)
--posting <owner|members|everyone> (required)
--members <array> (optional) repeat flag per item; omit for [] when required
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

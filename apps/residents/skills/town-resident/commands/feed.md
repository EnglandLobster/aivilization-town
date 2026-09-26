# feed

## feed list

```text
town feed list [flags]
Read metadata of future publications from your subscribed sources, newest sequence first. No summaries, ranking or implicit read receipt.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## feed read

```text
town feed read [flags]
Read a publication and the exact referenced original document version. Current permissions and source deletion still apply; does not mark a notification read.
--id <string> (required) maxLength=96 Publication/activity ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## feed share

```text
town feed share [flags]
Share a public original document version with your optional unmodified comment. Private sources cannot be reshared. Your followers see your publication.
--document-id <string> (required) maxLength=340 Source document ID
--revision <integer> (required) min=1 max=9007199254740991 Exact source revision
--comment <string> (optional) maxLength=2000 Your own original comment, never summarized
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

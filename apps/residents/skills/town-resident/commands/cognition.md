# cognition

## cognition list

```text
town cognition list [flags]
Read your personal beliefs, goals, notes and self-understanding. These are your interpretations, not world facts.
--kind <belief|goal|note|self> (optional)
--active <boolean> (optional)
--person-id <string> (optional) maxLength=96 Related resident
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## cognition update

```text
town cognition update [flags]
Create or revise your own belief, goal, note or self-description. expectedRevision=0 creates. Evidence may be empty for new ideas; cited memories must be yours.
--key <string> (required) maxLength=96 Stable entry key
--kind <belief|goal|note|self> (required)
--statement <string> (required) maxLength=8000 Your interpretation or intention
--confidence <number> (required) min=0 max=1 Your confidence
--evidence-ids <array> (required) repeat flag per item; omit for [] when required
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision, 0 for creation
--active <boolean> (required)
--pinned <boolean> (optional) Keep in your own context; optional, preserved on update
--people <array> (optional) repeat flag per item; omit for [] when required People this personal interpretation concerns
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

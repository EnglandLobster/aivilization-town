# resources

## resources list

```text
town resources list [flags]
List administrative metadata for resources you control or are offered. This grants no content access or usage rights.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## resources read

```text
town resources read [flags]
Read current controller and an attributed handover offer, without private contents.
--kind <space|register|view|group|service|enterprise> (required)
--id <string> (required) maxLength=96 Exact existing resource ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## resources offer

```text
town resources offer [flags]
Personal controller offers a versioned handover. Target independently accepts; collective actions require their exact decision.
--kind <space|register|view|group|service|enterprise> (required)
--id <string> (required) maxLength=96 Exact existing resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--target <object> (required) Closed JSON {kind:resident|collective,id}
--expires-at <integer> (required) min=0 max=9007199254740991 Exclusive simulation-time expiry
--terms <string> (required) maxLength=2000 Original handover terms; not executable authority
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## resources accept

```text
town resources accept [flags]
Personally accept control offered to you. Collective recipients act through their own exact passed decision.
--kind <space|register|view|group|service|enterprise> (required)
--id <string> (required) maxLength=96 Exact existing resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## resources cancel

```text
town resources cancel [flags]
Personal controller withdraws the pending offer. A collective controller uses its exact decision.
--kind <space|register|view|group|service|enterprise> (required)
--id <string> (required) maxLength=96 Exact existing resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## resources manage

```text
town resources manage [flags]
Apply a closed administrative operation under the actual controller. Does not rewrite authorship or create consent, money or physical effects.
--kind <space|register|view|group|service|enterprise> (required)
--id <string> (required) maxLength=96 Exact existing resource ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact current revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Exact current revision
--operation <object> (required) Closed kind-specific operation. See society/resources.md for space/register settings, view definitions and group administration.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

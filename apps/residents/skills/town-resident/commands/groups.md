# groups

## groups create

```text
town groups create [flags]
Create a group with only yourself as initial member.
--id <string> (required) maxLength=96 Record ID
--title <string> (required) maxLength=120 Original title
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups list

```text
town groups list [flags]
List groups you belong to.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups invitations

```text
town groups invitations [flags]
Read invitations addressed to you and applications to your groups.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups invite

```text
town groups invite [flags]
Invite a resident; they must independently accept.
--group-id <string> (required) maxLength=96 Group ID
--resident-id <string> (required) maxLength=96 Resident ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups join-request

```text
town groups join-request [flags]
Request membership; owner must approve.
--group-id <string> (required) maxLength=96 Group ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups accept

```text
town groups accept [flags]
Respond to an invitation (invitee) or application (owner).
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current group revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups reject

```text
town groups reject [flags]
Respond to an invitation (invitee) or application (owner).
--id <string> (required) maxLength=96 Record ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current group revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups transfer

```text
town groups transfer [flags]
Transfer ownership to an existing member.
--group-id <string> (required) maxLength=96 Group ID
--target-id <string> (required) maxLength=96 Member ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current group revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups leave

```text
town groups leave [flags]
Leave as member or close as owner. History retains original authors.
--group-id <string> (required) maxLength=96 Group ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current group revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups close

```text
town groups close [flags]
Leave as member or close as owner. History retains original authors.
--group-id <string> (required) maxLength=96 Group ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current group revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups members

```text
town groups members [flags]
Read a group you currently belong to.
--group-id <string> (required) maxLength=96 Group ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups messages

```text
town groups messages [flags]
Read a group you currently belong to.
--group-id <string> (required) maxLength=96 Group ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## groups send

```text
town groups send [flags]
Send your original message as a current member.
--group-id <string> (required) maxLength=96 Group ID
--content <string> (required) maxLength=8000 Original message
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

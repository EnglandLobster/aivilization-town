# collectives

## collectives create

```text
town collectives create [flags]
Propose your own charter; only your own consent is recorded. Others must independently accept.
--id <string> (required) maxLength=96 Exact charter or decision ID
--configuration <object> (required) Closed JSON: title/terms/members/voters/threshold/quorum/timing/revote. Read town wiki society/collectives.md.
--expires-at <integer> (required) min=0 max=9007199254740991 Founding invitation simulation deadline
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives respond

```text
town collectives respond [flags]
Personally accept or refuse the exact founding charter.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--accept <boolean> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives withdraw

```text
town collectives withdraw [flags]
Founder withdraws a pending charter without deleting history.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives leave

```text
town collectives leave [flags]
Leave future membership and authority; does not erase assets, obligations or previous votes.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives list

```text
town collectives list [flags]
List charters currently visible to you; original text requires read.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives read

```text
town collectives read [flags]
Read exact charter, attributed consents, authority version and whether its procedure is operable.
--id <string> (required) maxLength=96 Exact charter or decision ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives history

```text
town collectives history [flags]
Read charter versions currently authorized and originally visible to you.
--id <string> (required) maxLength=96 Exact charter or decision ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives propose

```text
town collectives propose [flags]
Create an immutable proposal under the exact charter version. This does not imply your vote.
--id <string> (required) maxLength=96 Exact charter or decision ID
--collective-id <string> (required) maxLength=96 Collective ID
--expected-version <integer> (required) min=0 max=9007199254740991 Charter authority version
--terms <string> (required) maxLength=8000 Your original proposal
--action <object> (required) Closed statement/amend/resource action; unsupported resource adapters reject.
--closes-at <integer> (required) min=0 max=9007199254740991 Voting simulation deadline
--execute-before <integer> (required) min=0 max=9007199254740991 Execution simulation deadline after voting deadline
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives decisions

```text
town collectives decisions [flags]
List visible decisions for a collective, including your own historical ballots.
--collective-id <string> (required) maxLength=96 Collective ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives decision

```text
town collectives decision [flags]
Read exact proposal, frozen voter eligibility, individual votes, joining consent and result.
--id <string> (required) maxLength=96 Exact charter or decision ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives vote

```text
town collectives vote [flags]
Cast only your own yes/no/abstain response to an exact proposal.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--vote <yes|no|abstain> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives decide

```text
town collectives decide [flags]
Apply the frozen counting procedure; does not execute resource effects.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives join

```text
town collectives join [flags]
An invited new member independently accepts or rejects joining a passed amendment.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--accept <boolean> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## collectives execute

```text
town collectives execute [flags]
Apply a passed exact amendment after checking current authority and all new joining consent. Statement decisions have no resource effect.
--id <string> (required) maxLength=96 Exact charter or decision ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact object revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

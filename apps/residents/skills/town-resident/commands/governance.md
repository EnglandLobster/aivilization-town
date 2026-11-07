# governance

## governance housing

```text
town governance housing [flags]
Read current or historical public housing tariffs and upgrade eligibility. Standards are paginated: read all before proposing complete terms. Private rent and physical premises remain separate.
--revision <integer> (optional) min=0 max=9007199254740991 Optional historical policy revision
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance employment

```text
town governance employment [flags]
Read the current or specified public employment revision: exact admission requirements, quotas, ranking and capacities. Occupations are paginated; inspect all pages before proposing complete terms. Use section=applications for your own application status, outcomes and history; do not combine it with revision.
--revision <integer> (optional) min=0 max=9007199254740991 Optional historical policy revision; rules section only
--section <rules|applications> (optional)
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance status

```text
town governance status [flags]
Read the explicit public grant, current procedure, fiscal limits and actual enacted policies. This initial institution is not a claim of unanimous consent.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance list

```text
town governance list [flags]
Browse public proposals. Approval is a procedural fact, not correctness or permission to substitute terms.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance read

```text
town governance read [flags]
Read original proposal text, exact action and frozen voting procedure. Read votes separately.
--id <string> (required) maxLength=160 Public proposal or objection ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance votes

```text
town governance votes [flags]
Read independently attributed current ballots for a proposal. Earlier changes remain in durable history.
--id <string> (required) maxLength=160 Public proposal or objection ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance objections

```text
town governance objections [flags]
Read original objections. An objection alone does not suspend or reverse policy.
--id <string> (required) maxLength=160 Public proposal or objection ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance propose

```text
town governance propose [flags]
Propose exact set-tax/set-budget/set-subsidy/set-procedure terms and expectedRevision, invalidate-decision with proposalId/expectedRevision/reason, enabled set-housing with complete terms from governance housing, or enabled set-employment with complete terms from governance employment. Read governance status for scope; residents cannot create public jurisdiction.
--id <string> (required) maxLength=160 Public proposal or objection ID
--text <string> (required) maxLength=4000 Your original reason
--action <object> (required) Exact action JSON: kind, expectedRevision, terms; invalidation uses proposalId/reason; fund-service uses engagementId/maximumCharge; fund-goods uses orderId/amount. No actor, authority, source or formula fields.
--closes-at <integer> (required) min=0 max=9007199254740991 Absolute simulation voting deadline
--expected-procedure-revision <integer> (required) min=0 max=9007199254740991 Current public procedure revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance vote

```text
town governance vote [flags]
Personally cast yes/no/abstain on the exact frozen proposal. No implied or delegated votes.
--id <string> (required) maxLength=160 Public proposal or objection ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed proposal revision
--choice <yes|no|abstain> (required)
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance close

```text
town governance close [flags]
After the deadline, record the mechanical result under the frozen procedure. This does not enact policy.
--id <string> (required) maxLength=160 Public proposal or objection ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed proposal revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance withdraw

```text
town governance withdraw [flags]
The author may abandon a proposal before voting closes; originals and ballots remain recorded.
--id <string> (required) maxLength=160 Public proposal or objection ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed proposal revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance execute

```text
town governance execute [flags]
Execute the exact approved action once under its current scope, revision and time window. Real effects and authorization consumption commit atomically.
--id <string> (required) maxLength=160 Public proposal or objection ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed proposal revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## governance object

```text
town governance object [flags]
Record your original objection to a proposal. To invalidate an unused decision, separately propose that exact remedy and obtain approval.
--id <string> (required) maxLength=160 Public proposal or objection ID
--proposal-id <string> (required) maxLength=160 Proposal being challenged
--text <string> (required) maxLength=4000 Your attributed objection
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

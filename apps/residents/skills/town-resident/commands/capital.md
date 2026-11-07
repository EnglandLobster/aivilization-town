# capital

## capital close

```text
town capital close [flags]
Current manager closes a capital-enabled company only after actual inventory disposal and all protected obligations and pending funding are settled. Residual cash goes to real current right holders; no valuation cash is invented.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--expected-equity-version <integer> (required) min=0 max=9007199254740991 Current capital version
--expected-control-version <integer> (required) min=0 max=9007199254740991 Current management version
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital list

```text
town capital list [flags]
List enterprises whose management, actual capital rights or agreements are visible to you. Holding rights does not grant management.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital rights

```text
town capital rights [flags]
Read paged current capital rights and original source; full company cash is only visible to actual management.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital agreements

```text
town capital agreements [flags]
List visible capital agreements for the enterprise. Proposed rights are not effective rights.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital read

```text
town capital read [flags]
Read the exact capital agreement, independent consents, held contributions and executable disposition. No participation is inferred.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--id <string> (required) maxLength=96 Immutable capital agreement ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital initialize

```text
town capital initialize [flags]
Current manager explicitly enables the capital ledger, preserving every inherited right. Does not transfer money, rights, employment or management.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital propose

```text
town capital propose [flags]
Freeze proposed rights, actual contributions and destinations. All existing and new holders and payers independently accept; company receipts additionally require current management authorization.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--id <string> (required) maxLength=96 Immutable capital agreement ID
--expected-equity-version <integer> (required) min=0 max=9007199254740991 Current capital version
--expires-at <integer> (required) min=0 max=9007199254740991 Absolute simulation deadline
--terms <string> (required) maxLength=4000 Your original terms
--allocation <object> (required) Exact JSON: positions:[{account:{sector:agent|collective,id},weight}], contributions:[{account:{sector:agent|collective,id},amount}], disbursements:[{account:{sector:agent|collective,id}|{sector:enterprise},amount}]. Amounts in currency, up to six decimal places; totals must balance. Weight is relative capital entitlement, not a management vote.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital accept

```text
town capital accept [flags]
Independently accept frozen terms for your account; your promised contribution moves to real escrow now. Collective accounts require a separately approved collective resource action.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--id <string> (required) maxLength=96 Immutable capital agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed agreement revision
--account-sector <agent|collective> (required)
--account-id <string> (required) maxLength=96 Actual rights/payer account ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital authorize

```text
town capital authorize [flags]
Current enterprise manager authorizes receiving the exact new company capital under the current management version. This is not shareholder consent.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--id <string> (required) maxLength=96 Immutable capital agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed agreement revision
--expected-control-version <integer> (required) min=0 max=9007199254740991 Current enterprise management version
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital execute

```text
town capital execute [flags]
A participating account controller executes once all independent consents, funding and current management conditions hold. Actual cash and rights commit atomically.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--id <string> (required) maxLength=96 Immutable capital agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## capital cancel

```text
town capital cancel [flags]
The proposer or a participating account controller withdraws an unfinished agreement; escrow refunds original real payer accounts. Executed rights cannot be erased.
--enterprise-id <string> (required) maxLength=96 Actual enterprise ID
--id <string> (required) maxLength=96 Immutable capital agreement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Exact observed agreement revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

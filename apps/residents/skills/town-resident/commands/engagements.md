# engagements

## engagements models

```text
town engagements models [flags]
Read registered physical effects, real input requirements and bounds. Names and reviews cannot add effects or qualifications.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements facilities

```text
town engagements facilities [flags]
Discover actual care/teaching stations and their declared physical source. A name is not physical supply.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements list

```text
town engagements list [flags]
List your visible private service agreements and openly published public-treasury procurement agreements. Other private agreements remain hidden.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements read

```text
town engagements read [flags]
Read the exact service agreement, own consent/participation, measured progress, escrow and exit state.
--id <string> (required) maxLength=60 Exact engagement ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements ledger

```text
town engagements ledger [flags]
Read measured original service settlements; other people bodily state is redacted.
--id <string> (required) maxLength=60 Exact engagement ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements offer

```text
town engagements offer [flags]
Propose immutable service terms and voluntary participants. Treasury payer requires explicit public procurement mode: terms, named parties and financial/time ledger become public; bodily details remain private. This creates no consent, payment or work.
--id <string> (required) maxLength=60 Exact engagement ID
--controller-kind <resident|collective> (required)
--controller-id <string> (required) maxLength=96 Resource controller ID
--title <string> (required) maxLength=120 Original service name
--terms <string> (required) maxLength=8000 Original service terms
--location-id <string> (required) maxLength=200 Actual location
--provider-id <string> (required) maxLength=96 Named provider
--recipient-id <string> (required) maxLength=96 Named recipient
--payer-sector <agent|collective|enterprise|treasury> (required)
--payer-id <string> (required) maxLength=96 Actual payer account
--revenue-sector <agent|collective|enterprise> (required)
--revenue-id <string> (required) maxLength=96 Revenue account; enterprise needs its own independent authorization
--provider-share-bps <integer> (required) min=0 max=10000 Provider share: 0 to 10000 basis points
--price-per-hour <number> (required) min=0 max=1000000 Price in currency per hour; up to six decimal places
--model-id <personal-assistance-v1|supportive-care-v1|guided-study-v1|meal-assistance-v1> (required)
--max-duration-ms <integer> (required) min=0 max=28800000 Maximum actual overlapping service time in milliseconds
--start-at <integer> (required) min=0 max=9007199254740991 Earliest simulation timestamp
--end-at <integer> (required) min=0 max=9007199254740991 Final simulation timestamp
--reservation-refs <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements accept

```text
town engagements accept [flags]
Recipient alone accepts these immutable terms; resources bind but nobody is forced to participate.
--id <string> (required) maxLength=60 Exact engagement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current immutable agreement state revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements fund

```text
town engagements fund [flags]
Private authorized payer escrows the price after recipient consent. Treasury funding uses governance propose/execute fund-service instead; payment cannot start anybody body.
--id <string> (required) maxLength=60 Exact engagement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current immutable agreement state revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements cancel

```text
town engagements cancel [flags]
A participant or current agreement controller ends future service; measured work settles and unearned money/materials return.
--id <string> (required) maxLength=60 Exact engagement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current immutable agreement state revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements leave

```text
town engagements leave [flags]
Personally leave your participation; actual service stops and both matching time reservations release.
--id <string> (required) maxLength=60 Exact engagement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current immutable agreement state revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## engagements start

```text
town engagements start [flags]
Personally reserve your own actual presence until the chosen time. Both named people must independently start, be present and fit the physical facility.
--id <string> (required) maxLength=60 Exact engagement ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current immutable agreement state revision
--until <integer> (required) min=0 max=9007199254740991 Your chosen end time, within the agreement window
--expected-employment-revision <integer> (optional) min=0 max=9007199254740991 Provider accepts exact current enterprise service authorization revision; read engagements read or business service first
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

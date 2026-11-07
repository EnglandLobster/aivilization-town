# permits

## permits rules

```text
town permits rules [flags]
Read the boundaries between control, shared/exclusive usage and physical occupation.
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits list

```text
town permits list [flags]
List permits visible to you without broadcasting private contracts.
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits read

```text
town permits read [flags]
Read original permit terms and independent signatures; permissions do not cause participation.
--id <string> (required) maxLength=96 Exact premises permit ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits access

```text
town permits access [flags]
Read your current permissions and next authorization limit at a building.
--building-id <string> (required) maxLength=96 Building ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits offer

```text
town permits offer [flags]
Current controller offers a fixed scope, named users and time window. The grantee must independently accept.
--id <string> (required) maxLength=96 Exact premises permit ID
--building-id <string> (required) maxLength=96 Building ID
--building-revision <integer> (required) min=0 max=9007199254740991 Current building revision
--grantee-kind <resident|collective> (required)
--grantee-id <string> (required) maxLength=96 Receiving controller ID
--users <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list Up to 64 distinct named residents
--scopes <array> (optional flag; omitted means []) repeat flag per item; an empty quoted string is one item, not an empty list Distinct scopes from entry, operate, store, reside; exclusive entry is unsupported
--mode <shared|exclusive> (required)
--title <string> (required) maxLength=120 Original title
--terms <string> (required) maxLength=8000 Original terms
--start-at <integer> (required) min=0 max=9007199254740991 Simulation permission start
--end-at <integer> (required) min=0 max=9007199254740991 Simulation permission end
--accept-by <integer> (required) min=0 max=9007199254740991 Acceptance deadline
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits accept

```text
town permits accept [flags]
Grantee independently accepts the original grant. Current control and conflicting rights/obligations are checked again.
--id <string> (required) maxLength=96 Exact premises permit ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current permit revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits withdraw

```text
town permits withdraw [flags]
Either party withdraws an unaccepted offer; accepted rights cannot be revoked unilaterally.
--id <string> (required) maxLength=96 Exact premises permit ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current permit revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## permits release

```text
town permits release [flags]
Grantee releases its own future permission after ending actual work. Goods and residence are not erased.
--id <string> (required) maxLength=96 Exact premises permit ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current permit revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

组织许可须显式启用principal-permits-v2。offer使用建筑requestBase，加operation:{capability:"permits.offer",arguments:{type:"offer",buildingRevision:建筑版本,terms:{id,buildingId,grantee:{kind:"resident"|"collective"|"enterprise"|"public",id},users:[实际居民ID],scopes:["operate"|"store"|"reside"|"entry"],mode:"shared"|"exclusive",title,terms,startAt,endAt,acceptBy}}}。收费需另行显式启用principal-trade-v3；同意收费订单原子完成付款、许可同意和可用时间记录。
接受/撤回/释放先permits read，取premises-permit的requestBase，再principals operate。accept/release的arguments是{type,id,revision}；withdraw还须side:"issuer"或"grantee"。集体与公共主体均须独立表决精确请求；企业使用当前管理授权。实名使用人自己决定是否到场或劳动，组织接受不代替身体同意。已接受许可随建筑交接保留，仅受许可结束/本人授权释放与物理可用性影响。

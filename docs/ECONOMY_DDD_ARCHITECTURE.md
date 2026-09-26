# Economy domain architecture

## Purpose

The economy is split into bounded contexts so adding bankruptcy, dividends,
credit, logistics, or new market mechanisms does not turn `world` into one
shared mutable model. The design uses DDD where it protects business
invariants; it does not require an entity class or repository wrapper for every
data structure.

## Dependency direction

```text
sim-core
   ↑
economy (money accounts, AMM, inventory, production, valuation)
   ↑
enterprise (enterprise aggregate and lifecycle policy)

credit (town-bank aggregate: deposits, loans, credit history)
   ↑
world (application orchestration, integration events, projections)
   ↑
worker / API / UI (adapters)

society ───────────────┘ (household, tax, welfare and public-policy rules)
```

Dependencies must point inward. `economy`, `enterprise` and `credit` never
import `world`, worker storage, or API types. A domain decision returns domain
events; the world application layer maps them to durable integration events.

## Bounded contexts and ownership

| Context            | Owns                                                                                                        | Does not own                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Economy foundation | accounts, balanced transactions, inventory math, AMM, production, renewable-resource stock arithmetic and valuation | agents, enterprises, regional persistence, scheduling |
| Enterprise         | business cash/inventory, employment membership, job postings, contracted wages, wage arrears, ownership shares, retained earnings, solvency and dividends | household balance/physiology, market pools, treasury |
| Credit             | town-bank cash account, deposit ledger, loan book, daily accrual/amortized collection, defaults, credit history and history-scaled credit limits | borrower cash authorization, cross-account transfers (world orchestrates) |
| Household/society  | consumption, durable goods, lifestyle, tax and welfare policy                                               | enterprise lifecycle, market settlement              |
| Fiscal             | treasury policy and public-service allocations                                                              | enterprise or household internal state               |
| World application  | cross-context authorization, command orchestration, event persistence, time cadence and read projections    | business-rule calculation that belongs to a domain   |

## Enterprise aggregate

`@aivilization/enterprise` is the aggregate boundary. State transitions go
through decision functions and `applyEnterpriseDomainEvent`; callers must not
invent status transitions or mutate enterprise financial totals directly.

The aggregate protects these invariants:

- enterprise cash and inventory cannot be negative;
- employee IDs are unique and cannot exceed capacity;
- hiring requires a published job posting with an open slot, and the contracted
  wage is recorded per employee at join time;
- payroll pays `min(wage + arrears repayment, balance)`: cash shortfalls accrue
  non-negative wage arrears (`paid + nextArrears === wage + arrears`) instead
  of rejecting work, and surpluses above the wage repay arrears first;
- ownership shares are positive and normalized to one;
- closed or bankrupt businesses cannot accept normal operations;
- dividends are limited by retained earnings, payout ratio and cash reserve,
  and may be taxed into the treasury at the tax policy's `dividendTaxRate`;
- insolvency must persist for the configured grace period before bankruptcy.

Legacy snapshots without ownership or earnings fields are normalized on read,
so the package boundary does not create a replay migration requirement.

## Renewable resource boundary

`@aivilization/economy/renewableResources` owns the pure extraction,
regeneration, carrying-capacity and policy validation rules. It has no region,
clock, projection or event-store dependency. `world` resolves an Agent's region,
enumerates elapsed regeneration cadences, records the factual
`RenewableResourceRegenerated` / `RenewableResourceExtracted` integration events,
and rebuilds the regional stock projection. The worker decision context calls the
same exported world availability function as command settlement, so planning
cannot use a different regeneration formula.

The v1 carrying-capacity experiment is deliberately restricted to one partition.
It must not be enabled for a multi-partition profile until extraction reservations
are owned by the simulation-wide authority; the server rejects that composition at
startup rather than allowing duplicate regional stocks.

## Credit aggregate

`@aivilization/credit` owns the town-bank aggregate. State transitions go
through decision functions and `applyCreditDomainEvent`; the world application
layer owns borrower identity, agent-side cash checks, and the actual
cross-account transfers. A single-partition runtime applies that aggregate in
its world stream. A multi-partition runtime has exactly one simulation-wide
authority instance: deposit, withdrawal, loan and daily accrual decisions run
there once, owner partitions receive their Agent cash event, and every
partition receives the same integration bank snapshot.

The aggregate protects these invariants:

- the bank cash account can never go negative; withdrawals are bounded by the
  depositor ledger and by the cash on hand (bank-illiquidity rejection);
- loan issuance is bounded by the history-scaled credit limit (each repaid
  loan compounds a bonus, each default compounds a penalty, clamped to policy
  bounds), the per-agent concurrency cap, and the reserve requirement: after
  issuance the bank must still hold `reserveRatio` of total deposits in cash;
- loan interest accrues daily on outstanding principal only (simple
  interest); the daily auto-collection amortizes `principal / remaining
  installments` plus all accrued interest, applies payments interest-first,
  and is capped by the borrower cash the world layer passes in;
- consecutive under-covered settlements increment the missed-payment counter
  (a fully covered day resets it); exceeding `graceMissedPayments` defaults
  the loan, records the outstanding book as the bank's loss, and grows the
  borrower's default history;
- deposit interest is paid daily out of the bank cash account (a spread cost
  the bank may lose on), never out of thin air and never out of principal.

Every movement is a transfer between the bank's circulating account and an
agent account, so banking never changes `moneySupply`. The optional bank
slice appears on the projection only from a scenario reserve seed or the
first credit event, keeping legacy snapshots byte-for-byte compatible.

Global time is phase ordered. At the start of a tick, a partition first
materializes already accepted authority events, then publishes its owner-state
clock boundary. The authority may advance only when every declared partition
has published through its current clock; it settles bank/global cadences before
the local household time phase and materializes those cash movements before
the local `AdvanceSimulationTime`. This prevents a fast partition from settling
credit against a mixture of old and new borrower balances. Legacy authority
snapshots without partition clock watermarks fail closed until every partition
publishes a fresh boundary.

## Cross-partition circulating-account ownership

An Agent ownership handoff moves the Agent account between execution shards;
it is not a mint, burn, payment, or change to town-wide money supply. New paired
`AgentOwnershipDeparted` / `AgentOwnershipArrived` integration events therefore
record the same `circulatingBalanceTransferred` fact. The source projection
subtracts that amount from its money-supply contribution and the destination
adds it, while the simulation-wide authority applies both events and observes a
net delta of zero. The amount must equal the transferred Agent balance and may
not exceed the source shard's money supply. Legacy transfer events without the
optional field retain their historical replay behavior.

## Accounting model

`@aivilization/economy/accounting` represents every currency movement as a
balanced transaction with explicit accounts. Signed entries must sum to zero.
The following account sectors are available:

- agent;
- enterprise;
- treasury;
- public service;
- town bank;
- market reserve;
- external sector;
- monetary authority.

`moneySupply` is a projection of circulating domestic accounts, not an
independent source of truth. Market, external and monetary-authority accounts
are excluded from that circulation scope. Legacy trade events that used zero as
an unspecified delta remain replayable; new non-zero deltas are checked against
the balanced transaction.

## External trade

Agents and enterprises trade with the external sector through
`AgentExportCommodity`/`AgentImportCommodity`. Pricing is pure domain math in
`@aivilization/economy/externalTrade`: the trader's regional AMM spot price is
adjusted by a rolling per-commodity net-export balance (positive = net
exports) whose saturating `√|balance|` impact makes repeated exports cheaper
for the buyer and repeated imports dearer for the town; the balance decays once
per policy cadence under `AdvanceSimulationTime`. Settlement moves funds
against the `external` account sector: exports inject `totalCurrency` into
circulation (moneySupply rises), imports burn it (moneySupply falls). The
optional projection slice is created only by external-trade events, keeping
legacy snapshots byte-for-byte compatible.

The canonical worker exposes these commands through the existing `trade`
micro-planner. Its versioned `external-trade-action-proposer-v1` adapter only
nominates an operational enterprise owner's trade when the equal-quantity
external total strictly beats the AMM total in the region that Agent can
actually trade in. This is a read-side opportunity filter only: `world` still
rechecks identity, enterprise authorization, cash/inventory, regional pool and
accounting atomically before emitting `ExternalTradeExecuted`.

## Command and event flow

```text
command
  → world application handler (identity, cross-aggregate funds, authorization)
  → enterprise decision function (business invariant)
  → domain event
  → world integration event (durable event stream)
  → bounded projection reducer
  → read models / agent decision context
```

`AdvanceSimulationTime` is a scheduler only. It enumerates crossed cadence
boundaries and asks the enterprise lifecycle policy for decisions. It does not
contain bankruptcy or dividend formulas.

## Extension rules

When adding an enterprise feature:

1. Add state only if it is required to enforce an enterprise invariant.
2. Add a pure decision function and domain event in `@aivilization/enterprise`.
3. Test accepted, rejected and replayed transitions in the domain package.
4. Map the decision to a durable world event in an application handler.
5. Apply it in the enterprise projection reducer.
6. Represent every currency movement with balanced accounting entries.
7. Expose only decision-relevant data to agent context.
8. Version policy semantics when a replay outcome changes.

For example, debt lives in the separate `@aivilization/credit` bounded
context with its own lender (the town bank), repayment schedule and default
lifecycle. The enterprise stores only references and obligations required for
its solvency calculation; it must not absorb the banking model.

## Testing requirements

- Domain tests pin aggregate invariants and lifecycle state machines.
- Accounting tests pin double-entry balance and circulation deltas.
- World integration tests pin atomic cross-aggregate effects.
- Replay tests keep historical events and optional legacy fields compatible.
- Full repository typecheck and tests are required after an event or policy
  version is introduced.

## 开放居民出行（resident-mobility-v1）

`mobility` 是独立纯领域包，拥有车辆/驾驶授权、司机登记、报价及行程生命周期；world 新增单向依赖以调用该领域决定，worker 依赖其公开只读类型/调度边界。没有反向依赖。`ResidentMobilityCommitted` 保存最终领域事实，独立 reducer 重放。实际位置与时间继续属于 world。

`residentMobilityCommand` 原子编排车辆状态、双方完全一致的真实旅行和 commerce 押金；`advanceResidentMobility` 在真实到达/订单时限边界处理结算。车费托管位于已有 `public-service:resident-commerce` 流通账户，采用平衡 entries，不新增货币或游离账户。`ride-deposit-` 命名空间只能由出行应用端口结算；普通居民 deposits 命令不可旁路。接客途中取消退款不会取消已发生的移动。

新 continuity 生活实验在 manifest.initialWorld 显式播种一辆车并记录 policy/provenance，旧 manifest 无此字段则关闭。不把实验能力视作 canonical/跨分区支持；详见 `specs/RESIDENT_MOBILITY_V1.md`。

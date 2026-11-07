import { serviceElapsedEffect } from './elapsedBody';
import {
  assertMoneySupplyDelta,
  type AccountingTransaction,
  type Inventory,
} from '@aivilization/economy';
import { applyResidentServiceEffect } from '@aivilization/society';
import { sameController } from '@aivilization/authority';
import { applyServiceEngagementEvent } from './engagementEvents';
import {
  serviceMoneyDifference,
  serviceMoneyMicros,
  SERVICE_ENGAGEMENT_ESCROW,
  engagementMoneyTransfer,
} from './engagementMoney';
import type {
  ServiceEngagementsState,
  ServiceEngagementEvent,
  ServiceMaterialInstruction,
  ServicePresence,
} from './engagementModel';
import { serviceFactsEqual as same } from './engagementFacts';
/** Validate correlated facts, never decide authorization or recalculate policy against today's world. */
export function applyServiceEngagementCommit(
  before: ServiceEngagementsState | undefined,
  events: readonly ServiceEngagementEvent[],
  transactions: readonly AccountingTransaction[],
  instructions: readonly ServiceMaterialInstruction[],
) {
  let state = before;
  for (const event of events) state = applyServiceEngagementEvent(state, event);
  if (!state) throw new Error('missing-service-engagement-state');
  const changes = events.flatMap((v) =>
      v.type === 'ServiceEngagementChanged' ? [v.engagement] : [],
    ),
    settlements = events.flatMap((v) =>
      v.type === 'ServiceEngagementSettled' ? [v.settlement] : [],
    );
  if (
    new Set(changes.map((e) => e.id)).size !== changes.length ||
    new Set(settlements.map((e) => e.engagementId)).size !== settlements.length ||
    settlements.some((f) => !changes.some((e) => e.id === f.engagementId))
  )
    throw new Error('duplicate-or-orphan-service-transition');
  const expectedMoney: Record<string, number> = {},
    actualMoney: Record<string, number> = {};
  const expectedTransactions: AccountingTransaction[] = [];
  const plus = (map: Record<string, number>, id: string, delta: number) => {
    map[id] = (map[id] ?? 0) + delta;
  };
  const expectedInstructions = new Set<string>(),
    reserves: ServicePresence[] = [],
    releases: ServicePresence[] = [];
  for (const e of changes) {
    const old = before?.engagements[e.id],
      f = settlements.find((v) => v.engagementId === e.id),
      evidenceId = `engagement-${e.id}-${e.revision}`;
    if (f) {
      if (
        !old ||
        f.id !== evidenceId ||
        e.progressMs !== f.progressMs ||
        serviceMoneyMicros(f.charge) !==
          serviceMoneyMicros(serviceMoneyDifference(e.charged, old.charged)) ||
        serviceMoneyMicros(f.providerPay) !==
          serviceMoneyMicros(serviceMoneyDifference(e.providerPaid, old.providerPaid)) ||
        serviceMoneyMicros(f.revenuePay) !==
          serviceMoneyMicros(serviceMoneyDifference(e.revenuePaid, old.revenuePaid))
      )
        throw new Error('service-settlement-progress-or-money-mismatch');
      const effect = f.elapsedBody
        ? serviceElapsedEffect(old, f.elapsedBody)
        : applyResidentServiceEffect({
            modelId: e.modelId,
            previousProgressMs: old.progressMs,
            nextProgressMs: e.progressMs,
            provider: f.providerBefore,
            recipient: f.recipientBefore,
            educationCeiling: old.educationCeiling ?? 0,
          });
      if (
        (f.elapsedBody &&
          (!('workedMs' in effect) ||
            effect.workedMs !== f.progressMs - f.previousProgressMs ||
            f.elapsedBody.from !== f.from ||
            f.elapsedBody.until !== f.at ||
            !same(f.elapsedBody.providerBefore, f.providerBefore) ||
            !same(f.elapsedBody.recipientBefore, f.recipientBefore))) ||
        !same(effect.provider, f.providerAfter) ||
        !same(effect.recipient, f.recipientAfter) ||
        !same(effect.consumed, f.consumed)
      )
        throw new Error('service-effect-proof-mismatch');
    } else if (e.progressMs !== (old?.progressMs ?? 0))
      throw new Error('service-progress-without-proof');
    const funded = !old?.fundedBy && e.fundedBy ? e.maximumCharge : 0,
      charge = serviceMoneyDifference(e.charged, old?.charged ?? 0),
      providerPay = serviceMoneyDifference(e.providerPaid, old?.providerPaid ?? 0),
      revenuePay = serviceMoneyDifference(e.revenuePaid, old?.revenuePaid ?? 0),
      refund = serviceMoneyDifference(e.refunded, old?.refunded ?? 0);
    if (funded > 0)
      expectedTransactions.push(
        engagementMoneyTransfer(`engagement-${e.id}-fund`, e.payer, funded, true),
      );
    if (providerPay > 0)
      expectedTransactions.push(
        engagementMoneyTransfer(
          `${evidenceId}-provider`,
          { sector: 'agent', id: e.providerId },
          providerPay,
          false,
        ),
      );
    if (revenuePay > 0)
      expectedTransactions.push(
        engagementMoneyTransfer(`${evidenceId}-revenue`, e.revenue, revenuePay, false),
      );
    if (refund > 0)
      expectedTransactions.push(
        engagementMoneyTransfer(`${evidenceId}-refund`, e.payer, refund, false),
      );
    plus(
      expectedMoney,
      SERVICE_ENGAGEMENT_ESCROW.accountId,
      serviceMoneyMicros(funded) - serviceMoneyMicros(charge) - serviceMoneyMicros(refund),
    );
    plus(
      expectedMoney,
      `${e.payer.sector}:${e.payer.id}`,
      serviceMoneyMicros(refund) - serviceMoneyMicros(funded),
    );
    plus(expectedMoney, `agent:${e.providerId}`, serviceMoneyMicros(providerPay));
    plus(expectedMoney, `${e.revenue.sector}:${e.revenue.id}`, serviceMoneyMicros(revenuePay));
    const needsMaterials =
      old &&
      ((old.status === 'offered' && e.status === 'accepted') ||
        (old.status !== 'offered' && (f !== undefined || e.status === 'ended')));
    const consumed: Record<string, number> = {};
    if (needsMaterials)
      for (const ref of e.materials) {
        const matched = instructions.filter(
          (i) => i.engagementId === e.id && i.reservationId === ref.id,
        );
        if (matched.length !== 1)
          throw new Error('service-material-instruction-missing-or-duplicated');
        const i = matched[0]!;
        if (
          i.evidenceId !== evidenceId ||
          !sameController(i.controller, e.controller) ||
          i.finish !== (e.status === 'ended') ||
          !Number.isSafeInteger(i.expectedRevision) ||
          i.expectedRevision < 1
        )
          throw new Error('service-material-instruction-mismatch');
        expectedInstructions.add(`${e.id}:${ref.id}`);
        for (const [item, n] of Object.entries(i.consumed)) {
          if (!Number.isFinite(n) || n <= 0)
            throw new Error('invalid-service-material-consumption');
          consumed[item] = (consumed[item] ?? 0) + n;
        }
      }
    if (!equalItems(consumed, f?.consumed ?? {}))
      throw new Error('service-material-consumption-proof-mismatch');
    for (const role of ['providerPresence', 'recipientPresence'] as const) {
      const was = old?.[role],
        now = e[role],
        expectedActor = role === 'providerPresence' ? e.providerId : e.recipientId;
      if (
        now &&
        (now.actorId !== expectedActor ||
          e.status !== 'funded' ||
          !Number.isSafeInteger(now.startedAt) ||
          !Number.isSafeInteger(now.until) ||
          now.until <= now.startedAt ||
          now.until > e.endAt ||
          now.startedAt < e.startAt)
      )
        throw new Error('invalid-service-presence');
      if (was && now && !same(was, now)) throw new Error('service-presence-rewritten');
      if (!was && now) {
        if (now.startedAt !== e.at || e.settledAt !== e.at)
          throw new Error('invalid-service-start-time');
        reserves.push(now);
      }
      if (was && !now) {
        if (e.status !== 'ended') throw new Error('service-presence-removed-without-ending');
        releases.push(was);
      }
    }
  }
  if (instructions.some((i) => !expectedInstructions.has(`${i.engagementId}:${i.reservationId}`)))
    throw new Error('orphan-service-material-instruction');
  if (new Set(transactions.map((t) => t.transactionId)).size !== transactions.length)
    throw new Error('duplicate-service-transaction');
  for (const t of transactions) {
    assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
    if (
      t.entries.length !== 2 ||
      !t.entries.some(
        (e) =>
          e.account.accountId === SERVICE_ENGAGEMENT_ESCROW.accountId &&
          e.account.sector === 'public-service',
      )
    )
      throw new Error('invalid-service-escrow-transfer');
    for (const entry of t.entries) {
      if (!entry.account.accountId.startsWith(`${entry.account.sector}:`))
        throw new Error('invalid-service-account');
      plus(
        actualMoney,
        entry.account.accountId,
        Math.sign(entry.amount) * serviceMoneyMicros(Math.abs(entry.amount)),
      );
    }
  }
  for (const id of new Set([...Object.keys(expectedMoney), ...Object.keys(actualMoney)]))
    if ((expectedMoney[id] ?? 0) !== (actualMoney[id] ?? 0))
      throw new Error('service-accounting-proof-mismatch');
  if (!same(expectedTransactions, transactions)) throw Error('service-transfer-evidence-mismatch');
  return { state, settlements, reserves, releases };
}
function equalItems(a: Inventory, b: Inventory) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (item) => Math.abs((a[item] ?? 0) - (b[item] ?? 0)) < 1e-9,
  );
}

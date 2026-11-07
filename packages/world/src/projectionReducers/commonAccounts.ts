import {
  applyCommonAccountEvent,
  assertMoneySupplyDelta,
  commonAccountNextBalance,
  type CommonAccountsState,
} from '@aivilization/economy';
import { applyEnterpriseDomainEvent } from '@aivilization/enterprise';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
export function applyCommonAccountsProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentCommonAccountsCommitted') return undefined;
  if (e.payload.policyVersion !== 'resident-common-accounts-v1')
    throw new Error('unsupported-common-accounts-policy');
  let state: CommonAccountsState | undefined = w.commonAccounts;
  for (const event of e.payload.events) state = applyCommonAccountEvent(state, event);
  if (!state) throw new Error('missing-common-accounts-state');
  const agents = { ...w.agents },
    enterprises = { ...w.enterprises };
  let treasury = w.treasury;
  const commonDelta: Record<string, number> = {},
    enterpriseDelta: Record<string, number> = {};
  for (const t of e.payload.transactions) {
    assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
    for (const entry of t.entries) {
      const sector = entry.account.sector,
        prefix = sector + ':';
      if (!entry.account.accountId.startsWith(prefix))
        throw new Error('invalid-common-account-counterparty');
      const id = entry.account.accountId.slice(prefix.length);
      if (sector === 'collective') {
        if (!state.accounts[id]) throw new Error('unknown-common-account');
        commonDelta[id] = (commonDelta[id] ?? 0) + entry.amount;
      } else if (sector === 'agent') {
        const a = agents[id],
          next = a
            ? commonAccountNextBalance(a.balance, entry.amount, Number.MAX_VALUE)
            : undefined;
        if (!a || next === undefined) throw new Error('invalid-common-account-agent-balance');
        agents[id] = { ...a, balance: next };
      } else if (sector === 'enterprise') {
        if (!enterprises[id] || entry.amount <= 0)
          throw new Error('invalid-common-account-enterprise-transfer');
        enterpriseDelta[id] = (enterpriseDelta[id] ?? 0) + entry.amount;
      } else if (
        sector === 'treasury' &&
        id === 'public-treasury' &&
        treasury !== undefined &&
        entry.amount > 0
      ) {
        const next = commonAccountNextBalance(treasury, entry.amount, Number.MAX_VALUE);
        if (next === undefined) throw new Error('invalid-common-account-treasury-balance');
        treasury = next;
      } else throw new Error('invalid-common-account-counterparty');
    }
  }
  for (const f of e.payload.enterpriseFunding) {
    const enterprise = enterprises[f.enterpriseId];
    if (!enterprise || f.event.type !== 'EnterpriseFunded')
      throw new Error('invalid-common-account-enterprise-effect');
    enterprises[f.enterpriseId] = applyEnterpriseDomainEvent(enterprise, f.event);
  }
  for (const id of new Set([
    ...Object.keys(state.accounts),
    ...Object.keys(w.commonAccounts?.accounts ?? {}),
    ...Object.keys(commonDelta),
  ])) {
    const before = w.commonAccounts?.accounts[id]?.balance ?? 0,
      after = state.accounts[id]?.balance ?? 0;
    if (Math.abs(after - before - (commonDelta[id] ?? 0)) > 1e-8)
      throw new Error('common-account-ledger-mismatch');
  }
  for (const id of new Set([
    ...Object.keys(enterpriseDelta),
    ...e.payload.enterpriseFunding.map((f) => f.enterpriseId),
  ])) {
    const before = w.enterprises[id]?.balance ?? 0,
      after = enterprises[id]?.balance;
    if (
      after === undefined ||
      !Number.isFinite(after) ||
      Math.abs(after - before - (enterpriseDelta[id] ?? 0)) > 1e-8
    )
      throw new Error('common-account-enterprise-ledger-mismatch');
  }
  // A receipt is the authorized ledger view of the same transaction, not an independent balance.
  const recorded = e.payload.events.flatMap((event) =>
    event.type === 'CommonAccountReceiptRecorded' && event.receipt.transaction
      ? [event.receipt.transaction]
      : [],
  );
  if (JSON.stringify(recorded) !== JSON.stringify(e.payload.transactions))
    throw new Error('common-account-receipt-mismatch');
  return {
    ...w,
    agents,
    enterprises,
    ...(treasury === undefined ? {} : { treasury }),
    commonAccounts: state,
  };
}

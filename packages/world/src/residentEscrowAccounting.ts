import {
  applyResidentEstateCashBatch,
  type ResidentEstateCashBatch,
} from './residentEstateCashBatch';
import {
  applyResidentEstateCashEffects,
  type ResidentEstateCashEffects,
} from './residentEstateCashEffects';
import type { EstateCashSourceReference } from '@aivilization/economy';
import type { ResourceSaleEnterpriseEffect } from './resourceSaleEnterpriseAccounting';
import type { PeriodicEnterpriseEffect } from './periodicEnterpriseAccounting';
import {
  CAPITAL_AGREEMENTS_POLICY,
  capitalAccountObligations,
  capitalReservedIncomingMicros,
} from '@aivilization/enterprise';
import type { CapitalEnterpriseEffect } from './capitalModel';
import type { PrincipalTradeEnterpriseEffect } from './principalTradeEnterpriseAccounting';
import { escrowEnterpriseEffects } from './escrowEnterpriseAccounting';
import type { ServiceEnterpriseAccounting } from './serviceEmploymentModel';
import {
  applyCommonAccountEvent,
  commonAccountNextBalance,
  settleCommonAccountExternalTransfer,
  type AccountingTransaction,
  type EconomicAccount,
  type CommonAccountEvent,
  type CommonAccountsState,
  COMMON_ACCOUNT_SETTLEMENT_SOURCES,
  type CommonAccountSettlementContext,
} from '@aivilization/economy';
import {
  tradeAccountObligations,
  tradeReservedCommonIncoming,
  periodicAccountObligations,
} from '@aivilization/commerce';
import {
  engagementAccountObligations,
  serviceReservedCommonIncoming,
  serviceFactsEqual as equal,
} from '@aivilization/services';
import { freightAccountObligations, freightReservedCommonIncoming } from '@aivilization/logistics';
import type { WorldProjection } from './projection';

/** Shared application boundary for closed escrow consumers; each owning domain still proves its exact transactions. */
type EscrowContext = CommonAccountSettlementContext;
const version = (context: EscrowContext) =>
  COMMON_ACCOUNT_SETTLEMENT_SOURCES[context].policyVersion;
export const residentEscrowIncoming = (
  w: Pick<WorldProjection, 'serviceEngagements' | 'logistics' | 'residentTrade' | 'enterprises'>,
  id: string,
) =>
  Object.values(w.enterprises).reduce(
    (n, e) =>
      n +
      capitalReservedIncomingMicros(e.capital, { sector: 'collective', id }) /
        CAPITAL_AGREEMENTS_POLICY.moneyScale,
    0,
  ) +
  serviceReservedCommonIncoming(w.serviceEngagements, id) +
  freightReservedCommonIncoming(w.logistics, id) +
  tradeReservedCommonIncoming(w.residentTrade, id);
export const residentEscrowObligations = (w: WorldProjection, id: string) =>
  periodicAccountObligations(w.periodicObligations, { sector: 'collective', id }).length > 0 ||
  Object.values(w.enterprises).some(
    (e) =>
      e.status !== 'closed' && capitalAccountObligations(e.capital, { sector: 'collective', id }),
  ) ||
  engagementAccountObligations(w.serviceEngagements, id) ||
  freightAccountObligations(w.logistics, id) ||
  tradeAccountObligations(w.residentTrade, id);
export function prepareEscrowCommonTransfers(input: {
  state: CommonAccountsState | undefined;
  context: EscrowContext;
  referenceId: string;
  actorId: string;
  at: number;
  requestId: string;
  transactions: readonly AccountingTransaction[];
}) {
  let state = input.state;
  const events: CommonAccountEvent[] = [];
  for (const [index, transaction] of input.transactions.entries())
    if (transaction.entries.some((e) => e.account.sector === 'collective')) {
      if (!state) return { accepted: false as const, reason: 'escrow-common-account-required' };
      const result = settleCommonAccountExternalTransfer({
        state,
        actorId: input.actorId,
        at: input.at,
        receiptId: `${input.requestId}-f${index}`,
        source: {
          context: input.context,
          referenceId: input.referenceId,
          policyVersion: version(input.context),
        },
        transaction,
      });
      if (!result.accepted) return result;
      state = result.state;
      events.push(...result.events);
    }
  return { accepted: true as const, state, events };
}
export function applyEscrowAccounting(input: {
  world: WorldProjection;
  context: EscrowContext;
  referenceIds: readonly string[];
  actorId: string;
  transactions: readonly AccountingTransaction[];
  commonEvents: readonly CommonAccountEvent[];
  escrowAccount: EconomicAccount;
  beforeEscrow: number;
  afterEscrow: number;
  allowTreasury?: boolean;
  settlementAt?: number;
  serviceEnterpriseEvents?: readonly ServiceEnterpriseAccounting[];
  capitalEnterpriseEvents?: readonly CapitalEnterpriseEffect[];
  tradeEnterpriseEvents?: readonly PrincipalTradeEnterpriseEffect[];
  resourceSaleEnterpriseEvents?: readonly ResourceSaleEnterpriseEffect[];
  periodicEnterpriseEvents?: readonly PeriodicEnterpriseEffect[];
  /** Only supplied after a consumer has corroborated its exact original domain ledger. */
  estateCashBatch?: {
    source: EstateCashSourceReference;
    originalTransactions: readonly AccountingTransaction[];
    batch: ResidentEstateCashBatch;
  };
  estateCashSettlement?: {
    readonly source: EstateCashSourceReference;
    readonly originalTransactions: readonly AccountingTransaction[];
    readonly effects: ResidentEstateCashEffects;
  };
}) {
  const w = input.world;
  const at = input.settlementAt ?? w.clock.now;
  if (!Number.isSafeInteger(at) || at < 0 || at > w.clock.now)
    throw Error('invalid-escrow-settlement-time');
  if (input.estateCashBatch && input.estateCashSettlement)
    throw Error('multiple-estate-settlement-protocols');
  const batch = input.estateCashBatch
    ? applyResidentEstateCashBatch(
        w,
        input.estateCashBatch.source,
        input.estateCashBatch.originalTransactions,
        input.estateCashBatch.batch,
        at,
      )
    : undefined;
  if (batch && !equal(batch.transactions, input.transactions))
    throw Error('escrow-estate-physical-ledger-mismatch');
  const estateSettlement = input.estateCashSettlement;
  const residentExits = estateSettlement
    ? applyResidentEstateCashEffects(
        w,
        estateSettlement.source,
        estateSettlement.originalTransactions,
        estateSettlement.effects,
        at,
      )
    : batch?.residentExits;
  if (
    estateSettlement &&
    !equal(input.transactions, estateSettlement.effects.resolution.transactions)
  )
    throw Error('escrow-estate-physical-ledger-mismatch');
  let common = w.commonAccounts;
  const commonRecords = input.commonEvents.filter((e) => e.type === 'CommonAccountReceiptRecorded'),
    commonTransactions = input.transactions.filter((t) =>
      t.entries.some((e) => e.account.sector === 'collective'),
    );
  if (
    !equal(
      commonRecords.map((e) => e.receipt.transaction),
      commonTransactions,
    )
  )
    throw Error('escrow-common-account-receipt-mismatch');
  for (const e of input.commonEvents) {
    if (e.type === 'CommonAccountChanged') {
      const old = common?.accounts[e.account.id];
      if (
        !old ||
        e.account.at !== at ||
        !equal({ ...e.account, balance: old.balance, revision: old.revision, at: old.at }, old)
      )
        throw Error('unrelated-escrow-common-account-change');
    } else if (
      e.type !== 'CommonAccountReceiptRecorded' ||
      e.receipt.operation !== 'externalSettlement' ||
      e.receipt.source?.context !== input.context ||
      e.receipt.source.policyVersion !== version(input.context) ||
      e.receipt.actorId !== input.actorId ||
      e.receipt.at !== at ||
      !input.referenceIds.includes(e.receipt.source.referenceId)
    )
      throw Error('invalid-escrow-common-account-event');
    common = applyCommonAccountEvent(common, e);
  }
  const { enterprises, ids: enterpriseIds } = escrowEnterpriseEffects({
    world: w,
    context: input.context,
    referenceIds: input.referenceIds,
    ...(input.serviceEnterpriseEvents ? { service: input.serviceEnterpriseEvents } : {}),
    ...(input.capitalEnterpriseEvents ? { capital: input.capitalEnterpriseEvents } : {}),
    ...(input.tradeEnterpriseEvents ? { trade: input.tradeEnterpriseEvents } : {}),
    ...(input.resourceSaleEnterpriseEvents
      ? { resourceSales: input.resourceSaleEnterpriseEvents }
      : {}),
    ...(input.periodicEnterpriseEvents ? { periodic: input.periodicEnterpriseEvents } : {}),
  });
  const enterpriseDelta: Record<string, number> = {};
  const agents = { ...w.agents },
    commonDelta: Record<string, number> = {};
  let escrowDelta = 0,
    treasury = w.treasury;
  for (const transaction of input.transactions)
    for (const entry of transaction.entries) {
      if (
        entry.account.accountId === input.escrowAccount.accountId &&
        entry.account.sector === input.escrowAccount.sector
      ) {
        escrowDelta += entry.amount;
        continue;
      }
      const id = entry.account.accountId.slice(entry.account.sector.length + 1);
      if (entry.account.sector === 'treasury' && input.allowTreasury && id === 'public-treasury') {
        const next = commonAccountNextBalance(treasury ?? 0, entry.amount, Number.MAX_VALUE);
        if (next === undefined) throw Error('invalid-escrow-treasury-balance');
        treasury = next;
        continue;
      }
      if (entry.account.sector === 'enterprise') {
        if (!enterpriseIds.has(id)) throw Error('enterprise-source-event-required');
        enterpriseDelta[id] = (enterpriseDelta[id] ?? 0) + entry.amount;
        continue;
      }
      if (entry.account.sector === 'collective') {
        commonDelta[id] = (commonDelta[id] ?? 0) + entry.amount;
        continue;
      }
      if (entry.account.sector === 'estate') {
        if ((!estateSettlement && !batch) || !residentExits)
          throw Error('escrow-estate-owning-receipts-required');
        // The owning cash reducer applied this exact transaction above; no second balance writes here.
        continue;
      }
      if (entry.account.sector !== 'agent') throw Error('invalid-escrow-counterparty');
      const a = agents[id],
        balance = a && commonAccountNextBalance(a.balance, entry.amount, Number.MAX_VALUE);
      if (!a || balance === undefined) throw Error('invalid-escrow-agent-balance');
      agents[id] = { ...a, balance };
    }
  if (Math.abs(input.afterEscrow - input.beforeEscrow - escrowDelta) > 1e-8)
    throw Error('escrow-ledger-mismatch');
  for (const id of new Set([...Object.keys(common?.accounts ?? {}), ...Object.keys(commonDelta)]))
    if (
      Math.abs(
        (common?.accounts[id]?.balance ?? 0) -
          (w.commonAccounts?.accounts[id]?.balance ?? 0) -
          (commonDelta[id] ?? 0),
      ) > 1e-8
    )
      throw Error('escrow-common-account-ledger-mismatch');
  for (const id of new Set([...enterpriseIds, ...Object.keys(enterpriseDelta)]))
    if (
      Math.abs(enterprises[id]!.balance - w.enterprises[id]!.balance - (enterpriseDelta[id] ?? 0)) >
      1e-8
    )
      throw Error('service-enterprise-cash-ledger-mismatch');
  return {
    agents,
    common,
    enterprises,
    ...(residentExits ? { residentExits } : {}),
    ...(treasury === undefined ? {} : { treasury }),
  };
}

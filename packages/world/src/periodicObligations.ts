import {
  prepareResidentEstateCashEffects,
  type ResidentEstateCashEffects,
} from './residentEstateCashEffects';
import { samePrincipalRequest, type PrincipalOperationRequest } from '@aivilization/authority';
import {
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  PERIODIC_OBLIGATIONS_CLEARING as CLEARING,
  applyPeriodicEvent,
  decidePeriodicObligation,
  decidePeriodicDue,
  expirePeriodicObligation,
  decodePeriodicCommand,
  periodicRequest,
  readPeriodicAccounts,
  periodicTransactions,
  nextPeriodicDueAt,
  tradeFactsEqual as equal,
  type PeriodicDecision,
  type PeriodicEvent,
} from '@aivilization/commerce';
import { assertPeriodicAccessState } from './periodicAccess';
import { enablePublicPeriodicObligationsAuthority } from '@aivilization/governance';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  assertWorldPrincipalOperationSource,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import { periodicObligationPorts } from './periodicObligationPorts';
import {
  preparePeriodicEnterpriseEffects,
  type PeriodicEnterpriseEffect,
} from './periodicEnterpriseAccounting';
import {
  prepareEscrowCommonTransfers,
  applyEscrowAccounting,
  residentEscrowIncoming,
} from './residentEscrowAccounting';
export type ResidentPeriodicObligationsPayload = {
  readonly policyVersion: typeof POLICY.version;
  readonly actorId: string;
  readonly event: PeriodicEvent;
  readonly transactions: readonly AccountingTransaction[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly enterpriseEvents: readonly PeriodicEnterpriseEffect[];
  readonly estateCashEffects?: ResidentEstateCashEffects;
};
type Context = {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
  readonly publicPrincipalExecution?: PublicPrincipalExecution;
};
const no = (reason: string) => ({ accepted: false as const, reason });
const eventId = (e: PeriodicEvent) =>
  e.type === 'PeriodicObligationsEnabled'
    ? 'enable'
    : e.type === 'PeriodicObligationOffered'
      ? e.obligation.id
      : e.id;
export function decodePeriodicOperation(r: PrincipalOperationRequest) {
  const c = decodePeriodicCommand(r.operation.arguments.command);
  if (
    r.resourceKind !== 'periodic-obligation' ||
    r.operation.capability !== `obligations.${c.type}`
  )
    throw Error('invalid-periodic-operation');
  return c;
}
export function worldPeriodicRequest(
  w: WorldProjection,
  c: ReturnType<typeof decodePeriodicCommand>,
) {
  if (!w.periodicObligations) throw Error('periodic-obligations-not-enabled');
  return periodicRequest(
    w.periodicObligations,
    c,
    c.type === 'offer' ? readPeriodicAccounts(periodicObligationPorts(w, 'system'), c) : undefined,
  );
}
const periodicEstateSource = (e: PeriodicEvent) => ({
  context: 'periodic-obligations' as const,
  id: eventId(e),
  revision: 'previousRevision' in e ? e.previousRevision + 1 : 1,
  policyVersion: POLICY.version,
});
function wrap(input: Context, actorId: string, d: PeriodicDecision) {
  if (!d.accepted || !d.events.length)
    return d.accepted ? { accepted: true as const, events: [] } : d;
  try {
    if (d.events.length !== 1) throw Error('periodic-single-packet-required');
    const event = d.events[0]!,
      after = applyPeriodicEvent(input.projection.periodicObligations, event),
      estateEffects =
        input.projection.residentExits && d.transactions.length
          ? prepareResidentEstateCashEffects(
              input.projection,
              periodicEstateSource(event),
              d.transactions,
            )
          : undefined,
      estateCashEffects = estateEffects?.resolution.mappings.length ? estateEffects : undefined,
      transactions = estateCashEffects?.resolution.transactions ?? d.transactions,
      common = prepareEscrowCommonTransfers({
        state: input.projection.commonAccounts,
        context: 'periodic-obligations',
        referenceId: eventId(event),
        actorId,
        at: input.projection.clock.now,
        requestId: input.requestId,
        transactions,
      });
    if (!common.accepted) return common;
    const payload: ResidentPeriodicObligationsPayload = {
        policyVersion: POLICY.version,
        actorId,
        event,
        transactions,
        commonAccountEvents: common.events,
        enterpriseEvents: preparePeriodicEnterpriseEffects(input.projection, after, event),
        ...(estateCashEffects ? { estateCashEffects } : {}),
      },
      e = createEventEnvelope({
        id: `${input.requestId}:periodic`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: input.projection.clock.now,
        type: 'ResidentPeriodicObligationsCommitted' as const,
        payload,
      });
    applyPeriodicObligationsProjection(
      input.projection,
      e,
      input.publicPrincipalExecution,
      input.collective,
    );
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-periodic-world-packet');
  }
}
export const enablePeriodicObligationsEvent = (input: Context) =>
  wrap(input, 'system', {
    accepted: true,
    events: [{ type: 'PeriodicObligationsEnabled', policy: POLICY }],
    transactions: [],
  });
export function residentPeriodicOperation(
  input: Context & { readonly actorId: string; readonly request: PrincipalOperationRequest },
) {
  if (!input.projection.periodicObligations) return no('periodic-obligations-not-enabled');
  try {
    const c = decodePeriodicOperation(input.request);
    if (!samePrincipalRequest(worldPeriodicRequest(input.projection, c), input.request))
      return no('periodic-exact-current-request-required');
    return wrap(
      input,
      input.actorId,
      decidePeriodicObligation(
        input.projection.periodicObligations,
        input.actorId,
        input.projection.clock.now,
        c,
        periodicObligationPorts(
          input.projection,
          input.actorId,
          input.collective,
          input.publicPrincipalExecution,
        ),
      ),
    );
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-periodic-operation');
  }
}
export function nextPeriodicBoundary(w: WorldProjection): number | undefined {
  const times = Object.values(w.periodicObligations?.contracts ?? {}).flatMap((c) => {
    const at = c.status === 'offered' ? c.acceptBy : nextPeriodicDueAt(c);
    return at === undefined ? [] : [at];
  });
  return times.length ? Math.min(...times) : undefined;
}
/** The time coordinator must reach each finite boundary; old/disabled worlds remain byte-identical. */
export function assertPeriodicTimeInterval(w: WorldProjection, until: number) {
  const at = nextPeriodicBoundary(w);
  if (at !== undefined && (at <= w.clock.now || at < until))
    throw Error('periodic-unsettled-boundary-must-be-processed');
}
export function advancePeriodicObligations(input: Context): readonly WorldEvent[] {
  let working = input.projection;
  const result: WorldEvent[] = [];
  for (;;) {
    const candidate = Object.values(working.periodicObligations?.contracts ?? {})
      .flatMap((c) => {
        const at = c.status === 'offered' ? c.acceptBy : nextPeriodicDueAt(c);
        return at === undefined || at > working.clock.now
          ? []
          : [{ id: c.id, at, offered: c.status === 'offered' }];
      })
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0];
    if (!candidate) return result;
    if (candidate.at !== working.clock.now) throw Error('periodic-retroactive-boundary-forbidden');
    const d = wrap(
      {
        ...input,
        projection: working,
        requestId: `${input.requestId}-${result.length}`,
        nextSequence: input.nextSequence + result.length,
      },
      'system',
      candidate.offered
        ? expirePeriodicObligation(working.periodicObligations!, candidate.id, working.clock.now)
        : decidePeriodicDue(
            working.periodicObligations!,
            candidate.id,
            working.clock.now,
            periodicObligationPorts(working, 'system'),
          ),
    );
    if (!d.accepted || d.events.length !== 1)
      throw Error(`periodic-due-failed:${d.accepted ? 'missing-receipt' : d.reason}`);
    const e = d.events[0]!;
    working = applyPeriodicObligationsProjection(working, e)!;
    result.push(e);
  }
}
/** Compares recorded reads with actual pre-event owning accounts, not a receipt's claim about itself. */
export function applyPeriodicObligationsProjection(
  w: WorldProjection,
  e: WorldEvent,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPeriodicObligationsCommitted') return undefined;
  const p = e.payload,
    event = p.event;
  assertPeriodicAccessState(w);
  if (p.policyVersion !== POLICY.version || e.occurredAt !== w.clock.now)
    throw Error('invalid-periodic-world-packet');
  if (event.type === 'PeriodicObligationsEnabled') {
    if (
      !w.publicGovernance ||
      p.actorId !== 'system' ||
      p.transactions.length ||
      p.enterpriseEvents.length ||
      p.commonAccountEvents.length ||
      p.estateCashEffects
    )
      throw Error('invalid-periodic-world-activation');
    return {
      ...w,
      periodicObligations: applyPeriodicEvent(w.periodicObligations, event),
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicPeriodicObligationsAuthority(w.publicGovernance.authority),
      },
    };
  }
  if (
    !w.periodicObligations ||
    (!w.periodicAccess && !w.publicGovernance?.authority.grant.periodicObligations)
  )
    throw Error('periodic-original-public-scope-required');
  const at = event.type === 'PeriodicObligationOffered' ? event.obligation.at : event.at;
  if (at !== w.clock.now) throw Error('periodic-world-time-mismatch');
  const automatic =
    event.type === 'PeriodicObligationExpired' || event.type === 'PeriodicInstallmentRecorded';
  if (automatic) {
    if (p.actorId !== 'system') throw Error('periodic-system-source-required');
    const c = w.periodicObligations.contracts[event.id];
    const due =
      event.type === 'PeriodicObligationExpired' ? c?.acceptBy : c && nextPeriodicDueAt(c);
    if (due !== w.clock.now) throw Error('periodic-actual-boundary-required');
  } else {
    if (event.actorId !== p.actorId || !w.agents[p.actorId])
      throw Error('periodic-actual-actor-required');
    assertWorldPrincipalOperationSource(
      w,
      event.type === 'PeriodicObligationOffered'
        ? event.obligation.offeredAuthorization
        : event.authorization,
      execution,
      collective,
    );
  }
  const source = 'sourceRead' in event ? event.sourceRead : undefined;
  if (source) {
    const terms =
      event.type === 'PeriodicObligationOffered'
        ? event.obligation
        : w.periodicObligations.contracts[eventId(event)];
    if (
      !terms ||
      !equal(source, readPeriodicAccounts(periodicObligationPorts(w, p.actorId), terms))
    )
      throw Error('periodic-owning-account-source-mismatch');
  }
  if (
    p.estateCashEffects &&
    (!p.estateCashEffects.resolution.mappings.length ||
      (event.type !== 'PeriodicInstallmentRecorded' &&
        (event.type !== 'PeriodicObligationChanged' || event.command.type !== 'settle')))
  )
    throw Error('periodic-estate-existing-payment-required');
  const periodicObligations = applyPeriodicEvent(w.periodicObligations, event);
  const originalTransactions = periodicTransactions(w.periodicObligations, event);
  if (
    !equal(p.transactions, p.estateCashEffects?.resolution.transactions ?? originalTransactions) ||
    !equal(p.enterpriseEvents, preparePeriodicEnterpriseEffects(w, periodicObligations, event))
  )
    throw Error('periodic-owning-settlement-mismatch');
  const accounting = applyEscrowAccounting({
    world: w,
    context: 'periodic-obligations',
    referenceIds: [eventId(event)],
    actorId: p.actorId,
    transactions: p.transactions,
    commonEvents: p.commonAccountEvents,
    periodicEnterpriseEvents: p.enterpriseEvents,
    escrowAccount: CLEARING,
    beforeEscrow: 0,
    afterEscrow: 0,
    allowTreasury: !!w.publicGovernance?.authority.grant.periodicObligations,
    ...(p.estateCashEffects
      ? {
          estateCashSettlement: {
            source: periodicEstateSource(event),
            originalTransactions,
            effects: p.estateCashEffects,
          },
        }
      : {}),
  });
  if (
    p.transactions.some((t) =>
      t.entries.some((x) => x.account.sector === 'treasury' && x.amount < 0),
    ) &&
    (accounting.treasury ?? 0) < (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0)
  )
    throw Error('periodic-public-reserve-violated');
  const next = {
    ...w,
    periodicObligations,
    agents: accounting.agents,
    enterprises: accounting.enterprises,
    ...(accounting.residentExits ? { residentExits: accounting.residentExits } : {}),
    ...(accounting.common ? { commonAccounts: accounting.common } : {}),
    ...(accounting.treasury === undefined ? {} : { treasury: accounting.treasury }),
  };
  for (const a of Object.values(next.commonAccounts?.accounts ?? {}))
    if (
      a.balance + residentEscrowIncoming(next, a.id) >
      next.commonAccounts!.policy.maxBalance + 1e-8
    )
      throw Error('periodic-common-capacity');
  return next;
}

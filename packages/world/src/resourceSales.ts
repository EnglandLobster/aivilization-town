import {
  boundPrincipalControlEffect,
  samePrincipalRequest,
  type PrincipalControlChanged,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  RESOURCE_SALES_POLICY,
  RESOURCE_SALES_POLICY_V2,
  extendResourceSalesPolicy,
  type ResourceSalesPolicy,
  RESOURCE_SALES_CLEARING,
  applyResourceSaleEvent,
  decideResourceSale,
  decodeResourceSaleCommand,
  expireResourceSale,
  resourceSaleControlEffect,
  resourceSaleRequest,
  tradeFactsEqual as equal,
  type ResourceSaleDecision,
  type ResourceSaleEvent,
} from '@aivilization/commerce';
import { prepareResourceSaleControl, applyResourceSaleControl } from './resourceSaleControl';
import {
  enablePublicResourceSalesAuthority,
  extendPublicResourceSalesAuthority,
} from '@aivilization/governance';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  assertWorldPrincipalOperationSource,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import { resourceSalePorts, worldResourceSaleSource } from './resourceSalePorts';
import {
  prepareResourceSaleEnterpriseEffects,
  type ResourceSaleEnterpriseEffect,
} from './resourceSaleEnterpriseAccounting';
import {
  prepareEscrowCommonTransfers,
  applyEscrowAccounting,
  residentEscrowIncoming,
} from './residentEscrowAccounting';
export type ResidentResourceSalesPayload = {
  readonly policyVersion: ResourceSalesPolicy['version'];
  readonly actorId: string;
  readonly event: ResourceSaleEvent;
  readonly transactions: readonly AccountingTransaction[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly enterpriseEvents: readonly ResourceSaleEnterpriseEffect[];
  readonly controlChange?: PrincipalControlChanged;
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
/** Closed domain command is supplied, owning source is computed; arbitrary caller source/effects are not accepted. */
export function decodeResourceSaleOperation(r: PrincipalOperationRequest) {
  const c = decodeResourceSaleCommand(r.operation.arguments.command);
  if (r.resourceKind !== 'resource-sale' || r.operation.capability !== `resource-sales.${c.type}`)
    throw Error('invalid-resource-sale-operation');
  return c;
}
function wrap(input: Context, actorId: string, d: ResourceSaleDecision) {
  if (!d.accepted) return d;
  if (!d.events.length) return { accepted: true as const, events: [] };
  try {
    const event = d.events[0]!;
    if (d.events.length !== 1) throw Error('resource-sale-single-packet-required');
    const transactions = event.type === 'ResourceSaleCommitted' ? event.transactions : [],
      common = prepareEscrowCommonTransfers({
        state: input.projection.commonAccounts,
        context:
          input.projection.resourceSales?.policy.version === RESOURCE_SALES_POLICY_V2.version
            ? 'resource-sales-v2'
            : 'resource-sales',
        referenceId: event.type === 'ResourceSaleCommitted' ? event.sale.id : 'enable',
        actorId,
        at: input.projection.clock.now,
        requestId: input.requestId,
        transactions,
      });
    if (!common.accepted) return common;
    const controlChange = prepareResourceSaleControl(input.projection, event, input.collective),
      payload: ResidentResourceSalesPayload = {
        policyVersion:
          event.type === 'ResourceSalesPolicyExtended'
            ? event.policy.version
            : (input.projection.resourceSales?.policy.version ?? RESOURCE_SALES_POLICY.version),
        actorId,
        event,
        transactions,
        commonAccountEvents: common.events,
        enterpriseEvents:
          event.type === 'ResourceSaleCommitted'
            ? prepareResourceSaleEnterpriseEffects(input.projection, event.sale)
            : [],
        ...(controlChange ? { controlChange } : {}),
      },
      e = createEventEnvelope({
        id: `${input.requestId}:resource-sale`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: input.projection.clock.now,
        type: 'ResidentResourceSalesCommitted' as const,
        payload,
      });
    applyResourceSalesProjection(
      input.projection,
      e,
      input.publicPrincipalExecution,
      input.collective,
    );
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-resource-sale-packet');
  }
}
export const enableResourceSalesEvent = (input: Context) =>
  wrap(input, 'system', {
    accepted: true,
    events: [{ type: 'ResourceSalesEnabled', policy: RESOURCE_SALES_POLICY }],
  });
export const extendResourceSalesEvent = (input: Context) =>
  input.projection.resourceSales
    ? wrap(input, 'system', extendResourceSalesPolicy(input.projection.resourceSales))
    : no('resource-sales-v1-required');
export function residentResourceSaleOperation(
  input: Context & { readonly actorId: string; readonly request: PrincipalOperationRequest },
) {
  const w = input.projection;
  if (!w.resourceSales) return no('resource-sales-not-enabled');
  try {
    const c = decodeResourceSaleOperation(input.request),
      old = w.resourceSales.sales[c.id],
      source = worldResourceSaleSource(
        w,
        c.type === 'offer' ? c.resource.id : (old?.source.id ?? ''),
        c.type === 'offer' ? c.resource.kind : (old?.source.kind ?? 'premises'),
      );
    if (!samePrincipalRequest(resourceSaleRequest(w.resourceSales, c, source), input.request))
      return no('resource-sale-exact-current-request-required');
    return wrap(
      input,
      input.actorId,
      decideResourceSale(
        w.resourceSales,
        input.actorId,
        w.clock.now,
        c,
        resourceSalePorts(w, input.actorId, input.collective, input.publicPrincipalExecution),
      ),
    );
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-resource-sale-operation');
  }
}
export function advanceResourceSales(input: Context): readonly WorldEvent[] {
  if (!input.projection.resourceSales) return [];
  const result: WorldEvent[] = [];
  for (const id of Object.keys(input.projection.resourceSales.sales).sort()) {
    const d = wrap(
      {
        ...input,
        requestId: `${input.requestId}-${result.length}`,
        nextSequence: input.nextSequence + result.length,
      },
      'system',
      expireResourceSale(input.projection.resourceSales, id, input.projection.clock.now),
    );
    if (!d.accepted) throw Error(`resource-sale-expiry-failed:${d.reason}`);
    result.push(...d.events);
  }
  return result;
}
/** Verify recorded child facts against owning pre-state; never grant standalone authority to a derived control proof. */
export function applyResourceSalesProjection(
  w: WorldProjection,
  e: WorldEvent,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentResourceSalesCommitted') return undefined;
  const p = e.payload,
    event = p.event;
  if (
    ![RESOURCE_SALES_POLICY.version, RESOURCE_SALES_POLICY_V2.version].includes(p.policyVersion) ||
    e.occurredAt !== w.clock.now ||
    (!w.resourceAdapters &&
      (!w.premises?.resourcePrincipals ||
        !w.materials?.resourcePrincipals ||
        !w.publicGovernance?.authority.grant.construction))
  )
    throw Error('invalid-resource-sales-world-packet');
  if (event.type === 'ResourceSalesEnabled' || event.type === 'ResourceSalesPolicyExtended') {
    if (w.resourceAdapters) throw Error('resource-adapters-already-own-sales-activation');
    if (
      p.actorId !== 'system' ||
      p.policyVersion !== event.policy.version ||
      (event.type === 'ResourceSalesPolicyExtended' && !w.residentMobility?.principalPolicy) ||
      p.transactions.length ||
      p.commonAccountEvents.length ||
      p.enterpriseEvents.length ||
      p.controlChange
    )
      throw Error('invalid-resource-sales-activation');
    return {
      ...w,
      resourceSales: applyResourceSaleEvent(w.resourceSales, event),
      publicGovernance: {
        ...w.publicGovernance!,
        authority:
          event.type === 'ResourceSalesEnabled'
            ? enablePublicResourceSalesAuthority(w.publicGovernance!.authority)
            : extendPublicResourceSalesAuthority(w.publicGovernance!.authority),
      },
    };
  }
  if (
    !w.resourceSales ||
    p.policyVersion !== w.resourceSales.policy.version ||
    event.actorId !== p.actorId ||
    event.sale.at !== w.clock.now ||
    !equal(event.transactions, p.transactions)
  )
    throw Error('resource-sale-world-receipt-mismatch');
  const actual = worldResourceSaleSource(w, event.sale.source.id, event.sale.source.kind);
  if (!equal(actual ?? null, event.sourceRead ?? null) && event.operation !== 'expire')
    throw Error('resource-sale-owning-source-mismatch');
  if (event.operation === 'expire') {
    if (p.actorId !== 'system') throw Error('resource-sale-system-source-required');
  } else {
    const a = event.authorization;
    if (!a || !w.agents[p.actorId] || !worldPrincipalAvailable(w, a.principal, collective))
      throw Error('resource-sale-current-authority-required');
    assertWorldPrincipalOperationSource(w, a, execution, collective);
  }
  const resourceSales = applyResourceSaleEvent(w.resourceSales, event),
    expected =
      event.authorization && event.operation !== 'offer' && event.operation !== 'expire'
        ? resourceSaleControlEffect(event.sale, event.command!, actual)
        : undefined;
  let controlled = w;
  if (expected) {
    if (
      !event.authorization ||
      !p.controlChange ||
      !samePrincipalRequest(p.controlChange.request, expected) ||
      !equal(
        p.controlChange.control.authorization,
        boundPrincipalControlEffect(event.authorization, expected),
      ) ||
      p.controlChange.control.at !== w.clock.now
    )
      throw Error('resource-sale-bound-control-mismatch');
    if (
      expected.command.type === 'accept' &&
      !worldPrincipalAvailable(w, event.sale.source.offer.target, collective)
    )
      throw Error('resource-sale-buyer-unavailable');
    controlled = applyResourceSaleControl(w, p.controlChange);
  } else if (p.controlChange) throw Error('resource-sale-unrelated-control-effect');
  if (!equal(prepareResourceSaleEnterpriseEffects(w, event.sale), p.enterpriseEvents))
    throw Error('resource-sale-enterprise-owning-source-mismatch');
  const ports = resourceSalePorts(w, p.actorId, collective, execution);
  if (['offer', 'accept'].includes(event.operation))
    for (const side of ['payer', 'revenue'] as const) {
      const a = ports.account(event.sale[side]),
        principal = side === 'payer' ? event.sale.source.offer.target : event.sale.source.seller;
      if (
        !a ||
        a.status !== 'open' ||
        a.principal.kind !== principal.kind ||
        a.principal.id !== principal.id ||
        !worldPrincipalAvailable(w, principal, collective)
      )
        throw Error('resource-sale-actual-account-required');
      if (
        event.operation === 'accept' &&
        (side === 'payer'
          ? a.balance < event.sale.amount
          : a.balance + event.sale.amount > a.maximumBalance)
      )
        throw Error('resource-sale-insufficient-funds-or-incoming-capacity');
    }
  const accounting = applyEscrowAccounting({
    world: w,
    context:
      w.resourceSales.policy.version === RESOURCE_SALES_POLICY_V2.version
        ? 'resource-sales-v2'
        : 'resource-sales',
    referenceIds: [event.sale.id],
    actorId: p.actorId,
    transactions: p.transactions,
    commonEvents: p.commonAccountEvents,
    resourceSaleEnterpriseEvents: p.enterpriseEvents,
    escrowAccount: RESOURCE_SALES_CLEARING,
    beforeEscrow: 0,
    afterEscrow: 0,
    allowTreasury: !!w.publicGovernance?.authority.grant.resourceSales,
  });
  if (
    event.operation === 'accept' &&
    event.sale.payer.sector === 'treasury' &&
    (accounting.treasury ?? 0) < (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0)
  )
    throw Error('resource-sale-treasury-reserve-violated');
  const next = {
    ...controlled,
    resourceSales,
    agents: accounting.agents,
    enterprises: accounting.enterprises,
    ...(accounting.common ? { commonAccounts: accounting.common } : {}),
    ...(accounting.treasury === undefined ? {} : { treasury: accounting.treasury }),
  };
  for (const a of Object.values(next.commonAccounts?.accounts ?? {}))
    if (
      a.balance + residentEscrowIncoming(next, a.id) >
      next.commonAccounts!.policy.maxBalance + 1e-8
    )
      throw Error('resource-sale-common-account-capacity');
  return next;
}

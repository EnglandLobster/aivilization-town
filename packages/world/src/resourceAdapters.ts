import { RESOURCE_PRINCIPAL_POLICY } from '@aivilization/authority';
import { applyMaterialCommit } from '@aivilization/materials';
import { applyPremisesCommit, PREMISES_PRINCIPALS_POLICY } from '@aivilization/premises';
import { applyVehiclePrincipalEvent, VEHICLE_PRINCIPALS_POLICY } from '@aivilization/mobility';
import {
  applyResourceSaleEvent,
  RESOURCE_SALES_POLICY,
  RESOURCE_SALES_POLICY_V2,
  type ResourceSaleKind,
} from '@aivilization/commerce';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export const RESOURCE_ADAPTER_VERSION = 'independent-resource-adapters-v1';
export type ResourceAdapterPolicy = {
  readonly version: typeof RESOURCE_ADAPTER_VERSION;
  readonly kinds: readonly ResourceSaleKind[];
};
const kinds = ['premises', 'stock', 'vehicle'] as const;
export function parseResourceAdapterKinds(value: unknown): ResourceSaleKind[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 3 ||
    value.some((v: unknown) => !kinds.some((k) => k === v)) ||
    new Set(value).size !== value.length
  )
    throw Error('invalid-resource-adapter-kinds');
  return kinds.filter((k) => value.includes(k));
}
function connected(w: WorldProjection, kind: ResourceSaleKind): boolean {
  return kind === 'stock'
    ? !!w.materials?.resourcePrincipals
    : kind === 'premises'
      ? !!w.premises?.resourcePrincipals
      : !!w.residentMobility?.principalPolicy;
}
/** Integration policy only. Owning domains retain physical state; public grants are independent. */
export function assertResourceAdapterState(w: WorldProjection) {
  const p = w.resourceAdapters;
  if (!p) return;
  if (
    p.version !== RESOURCE_ADAPTER_VERSION ||
    Object.keys(p).length !== 2 ||
    JSON.stringify(parseResourceAdapterKinds(p.kinds)) !== JSON.stringify(p.kinds) ||
    p.kinds.some((k) => !connected(w, k)) ||
    w.resourceSales?.policy.version !== RESOURCE_SALES_POLICY_V2.version
  )
    throw Error('inconsistent-resource-adapters-state');
}
export function applyResourceAdaptersProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentResourceAdaptersEnabled') return undefined;
  const p = e.payload;
  const selected = parseResourceAdapterKinds(p.kinds);
  if (
    p.version !== RESOURCE_ADAPTER_VERSION ||
    Object.keys(p).length !== 2 ||
    e.occurredAt !== w.clock.now ||
    JSON.stringify(selected) !== JSON.stringify(p.kinds) ||
    kinds.some(
      (k) => (connected(w, k) || w.resourceAdapters?.kinds.includes(k)) && !selected.includes(k),
    )
  )
    throw Error('invalid-resource-adapters-activation');
  let next = w;
  for (const kind of selected) {
    if (connected(next, kind)) continue;
    if (kind === 'stock') {
      if (!next.materials) throw Error('materials-not-enabled');
      next = {
        ...next,
        materials: applyMaterialCommit(next.materials, [
          { type: 'MaterialResourcePrincipalsEnabled', policy: RESOURCE_PRINCIPAL_POLICY },
        ]).state,
      };
    } else if (kind === 'premises') {
      if (!next.premises) throw Error('premises-not-enabled');
      next = {
        ...next,
        premises: applyPremisesCommit(next.premises, [
          { type: 'PremisesResourcePrincipalsEnabled', policy: PREMISES_PRINCIPALS_POLICY },
        ]).state,
      };
    } else {
      const s = next.residentMobility;
      if (
        !s ||
        Object.values(s.vehicles).some(
          (v) => !next.agents[v.ownerId] || v.authorized.some((id) => !next.agents[id]),
        )
      )
        throw Error('invalid-vehicle-principals-world-activation');
      next = {
        ...next,
        residentMobility: applyVehiclePrincipalEvent(s, {
          type: 'VehiclePrincipalsEnabled',
          policy: VEHICLE_PRINCIPALS_POLICY,
        }),
      };
    }
  }
  let sales =
    next.resourceSales ??
    applyResourceSaleEvent(undefined, {
      type: 'ResourceSalesEnabled',
      policy: RESOURCE_SALES_POLICY,
    });
  if (sales.policy.version === RESOURCE_SALES_POLICY.version)
    sales = applyResourceSaleEvent(sales, {
      type: 'ResourceSalesPolicyExtended',
      previousPolicyVersion: RESOURCE_SALES_POLICY.version,
      policy: RESOURCE_SALES_POLICY_V2,
    });
  next = { ...next, resourceAdapters: p, resourceSales: sales };
  assertResourceAdapterState(next);
  return next;
}
export function enableResourceAdaptersEvent(input: {
  projection: WorldProjection;
  kinds: unknown;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const requested = parseResourceAdapterKinds(input.kinds);
  // Preserve every previously connected adapter and its outstanding obligations.
  const selected = kinds.filter(
    (k) =>
      requested.includes(k) ||
      connected(input.projection, k) ||
      input.projection.resourceAdapters?.kinds.includes(k),
  );
  const e: WorldEvent = createEventEnvelope({
    id: `${input.requestId}:resource-adapters`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentResourceAdaptersEnabled',
    payload: { version: RESOURCE_ADAPTER_VERSION, kinds: selected } satisfies ResourceAdapterPolicy,
  });
  applyResourceAdaptersProjection(input.projection, e);
  return e;
}

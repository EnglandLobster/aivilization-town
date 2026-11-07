import { freightCustodian } from '@aivilization/logistics';
import { premisesTransferFacts } from '@aivilization/premises';
import { stockTransferFacts } from '@aivilization/materials';
import { vehicleTransferFacts } from '@aivilization/mobility';
import type {
  ResourceSaleSource,
  ResourceSalePorts,
  ResourceSaleKind,
} from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import { residentEscrowIncoming } from './residentEscrowAccounting';
/** Actual owning sources only. Text/effects supplied in a quote are never evidence of a building or obligation. */
export function worldResourceSaleSource(
  w: WorldProjection,
  id: string,
  kind: ResourceSaleKind = 'premises',
): ResourceSaleSource | undefined {
  if (w.resourceAdapters && !w.resourceAdapters.kinds.includes(kind)) return undefined;
  if (kind === 'stock' || kind === 'vehicle') {
    const facts =
      kind === 'stock'
        ? w.materials && stockTransferFacts(w.materials, id)
        : w.residentMobility && vehicleTransferFacts(w.residentMobility, id);
    if (!facts) return undefined;
    const refs = [...facts.encumbrances];
    for (const f of Object.values(w.logistics?.freight ?? {}))
      if (
        !['delivered', 'returned', 'cancelled'].includes(f.status) &&
        (kind === 'vehicle'
          ? freightCustodian(w.logistics?.custody, f).vehicleId === id
          : f.sourceStockId === id || f.destinationStockId === id)
      )
        refs.push({ kind: 'freight', id: f.id, revision: f.revision });
    if (kind === 'stock')
      for (const c of Object.values(w.materials?.custodies?.records ?? {}))
        if (
          ['reserved', 'loaded'].includes(c.status) &&
          (c.sourceStockId === id || c.destinationStockId === id)
        )
          refs.push({ kind: 'material-custody', id: c.id, revision: c.revision });
    return {
      ...facts,
      encumbrances: refs.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    };
  }
  const facts = w.premises && premisesTransferFacts(w.premises, id);
  if (!facts) return undefined;
  const refs: { kind: string; id: string; revision: number }[] = [];
  for (const p of Object.values(w.premisesRights?.permits ?? {}))
    if (p.buildingId === id) refs.push({ kind: 'permit', id: p.id, revision: p.revision });
  for (const p of Object.values(w.premisesRights?.provisions ?? {}))
    if (w.premisesRights?.permits[p.permitId]?.buildingId === id)
      refs.push({ kind: 'permit-provision', id: p.permitId, revision: p.revision });
  for (const l of Object.values(w.residentLeases?.leases ?? {}))
    if (l.locationId === facts.locationId)
      refs.push({ kind: 'lease', id: l.id, revision: l.revision });
  for (const s of Object.values(w.materials?.stocks ?? {}))
    if (s.locationId === facts.locationId)
      refs.push({ kind: 'stock', id: s.id, revision: s.revision });
  for (const e of Object.values(w.serviceEngagements?.engagements ?? {}))
    if (e.locationId === facts.locationId)
      refs.push({ kind: 'service-engagement', id: e.id, revision: e.revision });
  return {
    version: 'premises-sale-source-v1',
    ...facts,
    encumbrances: refs.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  };
}
export function resourceSalePorts(
  w: WorldProjection,
  actorId: string,
  collective?: PrincipalCollectivePort,
  execution?: PublicPrincipalExecution,
): ResourceSalePorts {
  return {
    exists: (id) => !!w.agents[id],
    available: (p) => worldPrincipalAvailable(w, p, collective),
    source: (kind, id) => worldResourceSaleSource(w, id, kind),
    authorize: (p, r) => authorizeWorldPrincipalOperation(w, actorId, p, r, execution, collective),
    account: (a) => {
      if (a.sector === 'agent') {
        const r = w.agents[a.id];
        return r
          ? {
              principal: { kind: 'resident', id: a.id },
              balance: r.balance,
              status: 'open',
              maximumBalance: Number.MAX_VALUE,
            }
          : undefined;
      }
      if (a.sector === 'enterprise') {
        const e = w.enterprises[a.id];
        return e && e.status === 'active'
          ? {
              principal: { kind: 'enterprise', id: a.id },
              balance: e.balance,
              status: 'open',
              maximumBalance: Number.MAX_VALUE,
            }
          : undefined;
      }
      if (a.sector === 'collective') {
        const c = w.commonAccounts?.accounts[a.id];
        return c && c.status !== 'closed'
          ? {
              principal: { kind: 'collective', id: c.collectiveId },
              balance: c.balance,
              status: c.status,
              maximumBalance: Math.max(
                0,
                w.commonAccounts.policy.maxBalance - residentEscrowIncoming(w, a.id),
              ),
            }
          : undefined;
      }
      const grant = w.publicGovernance?.authority.grant;
      return a.id === 'public-treasury' && grant?.resourceSales
        ? {
            principal: { kind: 'public', id: grant.id },
            balance: Math.max(
              0,
              (w.treasury ?? 0) - (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0),
            ),
            status: 'open',
            maximumBalance: Number.MAX_VALUE,
          }
        : undefined;
    },
  };
}

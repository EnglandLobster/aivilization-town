import type {
  PrincipalTradeAccount,
  PrincipalTradePorts,
  PrincipalPermitTradeEvidence,
} from '@aivilization/commerce';
import { isPrincipalPremisesPermit } from '@aivilization/premises';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';

/** The permit and its provision are the only source; a fee order cannot testify to its own fulfillment. */
export function principalPermitTradeEvidence(
  w: WorldProjection,
  id: string,
): PrincipalPermitTradeEvidence | undefined {
  const p = w.premisesRights?.permits[id],
    q = w.premisesRights?.provisions?.[id];
  if (!p || !isPrincipalPremisesPermit(p)) return undefined;
  return {
    sourceVersion: 'principal-premises-provision-v2',
    revision: p.revision + (q?.revision ?? 0),
    permitRevision: p.revision,
    at: Math.max(p.at, q?.settledAt ?? p.at),
    status: p.status,
    ...(p.accepted ? { acceptedAt: p.accepted.at } : {}),
    ...(p.closed ? { closedAt: p.closed.at } : {}),
    ...(q
      ? {
          provision: {
            orderId: q.orderId,
            revision: q.revision,
            settledAt: q.settledAt,
            availableMs: q.availableMs,
            unavailableMs: q.unavailableMs,
          },
        }
      : {}),
    basis: {
      kind: 'permit',
      id: p.id,
      seller: p.issuer,
      buyer: p.grantee,
      principalVersion: p.principalVersion,
      createdAt: p.offered.at,
      buildingId: p.buildingId,
      issuerVersion: p.issuerVersion,
      users: p.users,
      scopes: p.scopes,
      mode: p.mode,
      title: p.title,
      terms: p.terms,
      startAt: p.startAt,
      endAt: p.endAt,
      acceptBy: p.acceptBy,
    },
  };
}
/** Ownership of money is distinct from the resident who manages an enterprise. */
export function principalTradeAccount(
  w: WorldProjection,
  a: PrincipalTradeAccount,
): ReturnType<PrincipalTradePorts['account']> {
  if (a.sector === 'agent') {
    const resident = w.agents[a.id];
    return resident
      ? { principal: { kind: 'resident', id: a.id }, balance: resident.balance, status: 'open' }
      : undefined;
  }
  if (a.sector === 'enterprise') {
    const e = w.enterprises[a.id];
    return e && e.status !== 'closed'
      ? {
          principal: { kind: 'enterprise', id: a.id },
          balance: e.balance,
          status: e.status === 'active' ? 'open' : 'settling',
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
        }
      : undefined;
  }
  const grant = w.publicGovernance?.authority.grant;
  return a.id === 'public-treasury' && grant?.principalTrade
    ? {
        principal: { kind: 'public', id: grant.id },
        balance: Math.max(
          0,
          (w.treasury ?? 0) - (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0),
        ),
        status: 'open',
      }
    : undefined;
}
export function principalEvidenceTradePorts(
  w: WorldProjection,
  actorId: string,
  collective?: PrincipalCollectivePort,
  execution?: PublicPrincipalExecution,
): PrincipalTradePorts {
  return {
    evidence: (id) => principalPermitTradeEvidence(w, id),
    account: (a) => principalTradeAccount(w, a),
    available: (p) => worldPrincipalAvailable(w, p, collective),
    exists: (id) => !!w.agents[id],
    authorize: (p, r) => authorizeWorldPrincipalOperation(w, actorId, p, r, execution, collective),
  };
}

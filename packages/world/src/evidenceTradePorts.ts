import { isPrincipalPremisesPermit } from '@aivilization/premises';
import type { Controller } from '@aivilization/authority';
import type { EvidenceTradePorts, TradeEvidence, TradeSourceRef } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import { residentFinancialAccount } from './residentFinancialAccounts';
export type EvidenceTradeAuthorization = Pick<
  EvidenceTradePorts,
  'authorize' | 'controllerAvailable' | 'actingFor'
> & {
  readonly authorizePublicFunding?: NonNullable<EvidenceTradePorts['publicFunding']>['authorize'];
};
/** Extract final owning-domain facts only. No text parsing, quality assessment, current policy calculation or resident proof fields. */
export function residentTradeEvidence(
  w: WorldProjection,
  source: TradeSourceRef,
): TradeEvidence | undefined {
  if (source.kind === 'permit') {
    const p = w.premisesRights?.permits[source.id],
      q = w.premisesRights?.provisions?.[source.id];
    if (!p || isPrincipalPremisesPermit(p)) return undefined;
    return {
      sourceVersion: 'premises-provision-v1',
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
  if (source.kind === 'freight') {
    const f = w.logistics?.freight[source.id];
    return f
      ? {
          sourceVersion: 'resident-logistics-v1',
          revision: f.revision,
          at: f.at,
          status: f.status,
          basis: {
            kind: 'freight',
            id: f.id,
            seller: f.controller,
            buyer: f.recipient,
            createdAt: f.createdAt,
            sourceStockId: f.sourceStockId,
            destinationStockId: f.destinationStockId,
            sourceLocationId: f.sourceLocationId,
            destinationLocationId: f.destinationLocationId,
            items: f.items,
            deadline: f.deadline,
          },
        }
      : undefined;
  }
  if (source.kind !== 'service') return undefined;
  const s = w.serviceEngagements?.engagements[source.id];
  if (!s) return undefined;
  const collective =
    s.payer.sector === 'collective'
      ? w.commonAccounts?.accounts[s.payer.id]?.collectiveId
      : undefined;
  const buyer: Controller | undefined =
    s.payer.sector === 'agent'
      ? { kind: 'resident', id: s.payer.id }
      : collective
        ? { kind: 'collective', id: collective }
        : undefined;
  return buyer
    ? {
        sourceVersion: 'resident-service-engagements-v1',
        revision: s.revision,
        at: s.at,
        status: s.status,
        progressMs: s.progressMs,
        hasPresence: !!s.providerPresence || !!s.recipientPresence,
        basis: {
          kind: 'service',
          id: s.id,
          seller: s.controller,
          buyer,
          createdAt: s.createdAt,
          providerId: s.providerId,
          recipientId: s.recipientId,
          locationId: s.locationId,
          pricePerHour: s.pricePerHour,
          maxDurationMs: s.maxDurationMs,
          startAt: s.startAt,
          endAt: s.endAt,
        },
      }
    : undefined;
}
export function residentEvidenceTradePorts(
  w: WorldProjection,
  authorization: EvidenceTradeAuthorization,
): EvidenceTradePorts {
  return {
    ...authorization,
    exists: (id) => !!w.agents[id],
    account: (a) => residentFinancialAccount(w, a),
    ...(w.residentTrade?.publicFunding
      ? {
          publicFunding: {
            balance: Math.max(
              0,
              (w.treasury ?? 0) - (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0),
            ),
            authorize: authorization.authorizePublicFunding ?? (() => undefined),
          },
        }
      : {}),
    evidence: (ref) => residentTradeEvidence(w, ref),
  };
}

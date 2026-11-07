import {
  assertPrincipalAuthorization,
  assertPrincipalOperationRequest,
  samePrincipal,
  principalId,
  type PrincipalOperationRequest,
  type ResourcePrincipal,
} from '@aivilization/authority';
import { conflictingPremisesPermit } from './rightsAccess';
import { validPrincipalPremisesPermitTerms } from './rightsValidation';
import {
  PRINCIPAL_PREMISES_RIGHTS_POLICY,
  isPrincipalPremisesPermit,
  type PremisesRightsState,
  type PremisesPermit,
  type PrincipalPremisesRightsCommand,
  type PrincipalPremisesRightsDecision,
  type PrincipalPremisesRightsEvent,
  type PrincipalPremisesRightsPorts,
  type PrincipalPermitProof,
  type PrincipalPermitTradeBinding,
} from './rightsModel';

/** The request freezes the complete contract; authorization cannot be reused for another user or term. */
export function principalPermitRequest(
  s: PremisesRightsState,
  c: PrincipalPremisesRightsCommand,
  ports: Pick<PrincipalPremisesRightsPorts, 'building'>,
): PrincipalOperationRequest {
  if (c.type === 'offer') {
    const b = ports.building(c.terms.buildingId);
    if (!b || b.control.policyVersion !== 'resource-principals-v2')
      throw Error('principal-premises-not-transitioned');
    return {
      resourceKind: 'premises',
      resourceId: b.id,
      resourceRevision: c.buildingRevision,
      controlVersion: b.control.version,
      operation: { capability: 'permits.offer', arguments: structuredClone(c) },
    };
  }
  const p = s.permits[c.id];
  if (!p || !isPrincipalPremisesPermit(p)) throw Error('principal-permit-not-found');
  return {
    resourceKind: 'premises-permit',
    resourceId: p.id,
    resourceRevision: c.revision,
    controlVersion: p.issuerVersion,
    operation: { capability: `permits.${c.type}`, arguments: structuredClone(c) },
  };
}
export function principalPermitSubject(
  s: PremisesRightsState,
  c: PrincipalPremisesRightsCommand,
  ports: Pick<PrincipalPremisesRightsPorts, 'building'>,
): ResourcePrincipal {
  if (c.type === 'offer') {
    const b = ports.building(c.terms.buildingId);
    if (!b) throw Error('permit-building-unavailable');
    return b.control.controller;
  }
  const p = s.permits[c.id];
  if (!p || !isPrincipalPremisesPermit(p)) throw Error('principal-permit-not-found');
  return c.type === 'withdraw' && c.side === 'issuer' ? p.issuer : p.grantee;
}

/** Parent consent is a distinct event; it never pretends that a separate permits.accept was approved. */
export function principalPermitTradeRequest(
  binding: PrincipalPermitTradeBinding,
): PrincipalOperationRequest {
  if (
    !principalId(binding.orderId) ||
    binding.orderId.length > 60 ||
    !Number.isSafeInteger(binding.orderRevision) ||
    binding.orderRevision < 1 ||
    Object.keys(binding).length !== 2
  )
    throw Error('invalid-principal-permit-trade-binding');
  return {
    resourceKind: 'evidence-order',
    resourceId: binding.orderId,
    resourceRevision: binding.orderRevision,
    controlVersion: 1,
    operation: {
      capability: 'trades.accept',
      arguments: { type: 'accept', id: binding.orderId, expectedRevision: binding.orderRevision },
    },
  };
}
export function decidePrincipalPremisesRights(
  s: PremisesRightsState,
  actorId: string,
  at: number,
  c: PrincipalPremisesRightsCommand,
  ports: PrincipalPremisesRightsPorts,
  tradeBinding?: PrincipalPermitTradeBinding,
): PrincipalPremisesRightsDecision {
  const no = (reason: string): PrincipalPremisesRightsDecision => ({ accepted: false, reason });
  if (tradeBinding && c.type !== 'accept') return no('principal-permit-trade-accept-only');
  if (!s.principalPolicy) return no('principal-permits-not-enabled');
  if (!principalId(actorId) || !ports.exists(actorId) || !Number.isSafeInteger(at) || at < 0)
    return no('invalid-permit-actor-or-time');
  let authorization: PrincipalPermitProof;
  try {
    const request = tradeBinding
        ? principalPermitTradeRequest(tradeBinding)
        : principalPermitRequest(s, c, ports),
      subject = principalPermitSubject(s, c, ports);
    assertPrincipalOperationRequest(request);
    if (!ports.available(subject)) return no('permit-party-unavailable');
    const proof = ports.authorize(subject, request);
    if (!proof) return no('principal-permit-authority-required');
    assertPrincipalAuthorization(proof, subject, request, actorId);
    authorization = proof;
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-principal-permit');
  }
  if (c.type === 'offer') {
    const b = ports.building(c.terms.buildingId)!;
    if (b.status !== 'operational' || b.condition <= 0) return no('permit-building-unavailable');
    if (b.revision !== c.buildingRevision) return no('permit-building-revision-conflict');
    if (b.control.offer) return no('permit-control-transfer-pending');
    const terms = {
      ...structuredClone(c.terms),
      issuer: structuredClone(b.control.controller),
      issuerVersion: b.control.version,
      principalVersion: PRINCIPAL_PREMISES_RIGHTS_POLICY.version,
    };
    if (
      !validPrincipalPremisesPermitTerms(terms, at, s.policy) ||
      terms.users.some((id) => !ports.exists(id)) ||
      !ports.available(terms.grantee)
    )
      return no('invalid-permit-terms');
    if (s.permits[terms.id]) return no('permit-already-exists');
    if (
      Object.keys(s.permits).length >= s.policy.maxPermits ||
      Object.values(s.permits).filter((p) => p.buildingId === b.id).length >=
        s.policy.maxPermitsPerBuilding
    )
      return no('permit-limit');
    if (terms.scopes.includes('reside') && b.blueprint.primaryUse !== 'residence')
      return no('permit-residential-building-required');
    return {
      accepted: true,
      events: [{ type: 'PrincipalPremisesPermitOffered', terms, authorization, at }],
    };
  }
  const p = s.permits[c.id]!;
  if (p.revision !== c.revision) return no('permit-revision-conflict');
  if (at < p.at) return no('invalid-permit-time');
  if (c.type === 'accept') {
    if (p.status !== 'offered' || at >= p.acceptBy) return no('permit-offer-unavailable');
    const b = ports.building(p.buildingId);
    if (
      !b ||
      b.status !== 'operational' ||
      b.condition <= 0 ||
      b.control.offer ||
      b.control.version !== p.issuerVersion ||
      !samePrincipal(b.control.controller, p.issuer)
    )
      return no('permit-control-changed');
    if (conflictingPremisesPermit(s, { ...p, startAt: Math.max(at, p.startAt) }))
      return no('permit-exclusive-conflict');
    const conflict = ports.conflict(p, at);
    if (conflict) return no(conflict);
    return {
      accepted: true,
      events: [
        {
          ...(tradeBinding
            ? {
                type: 'PrincipalPremisesPermitTradeAccepted' as const,
                binding: structuredClone(tradeBinding),
              }
            : { type: 'PrincipalPremisesPermitAccepted' as const }),
          id: p.id,
          revision: p.revision + 1,
          authorization,
          at,
        },
      ],
    };
  }
  if (c.type === 'release') {
    if (p.status !== 'accepted' || at >= p.endAt) return no('permit-not-active');
    if (s.provisions?.[p.id] && s.provisions[p.id]!.settledAt < Math.min(at, p.endAt))
      return no('provision-must-settle-before-permit-closes');
    const blocked = ports.releaseBlocked(p, at);
    if (blocked) return no(blocked);
  } else if (p.status !== 'offered') return no('permit-offer-unavailable');
  return {
    accepted: true,
    events: [
      {
        type: 'PrincipalPremisesPermitClosed',
        id: p.id,
        revision: p.revision + 1,
        reason: c.type === 'release' ? 'released' : 'withdrawn',
        side: c.type === 'release' ? 'grantee' : c.side,
        authorization,
        at,
      },
    ],
  };
}

/** Versioned facts and proof binding only. Current management/voting policy is checked by the world application. */
export function applyPrincipalPremisesRightsEvent(
  s: PremisesRightsState,
  e: PrincipalPremisesRightsEvent,
): PremisesRightsState {
  if (e.type === 'PrincipalPremisesRightsEnabled') {
    if (
      s.principalPolicy ||
      Object.keys(e.policy).length !== 1 ||
      e.policy.version !== PRINCIPAL_PREMISES_RIGHTS_POLICY.version
    )
      throw Error('invalid-principal-permits-activation');
    return { ...s, principalPolicy: structuredClone(e.policy) };
  }
  if (!s.principalPolicy) throw Error('principal-permits-not-enabled');
  if (!Number.isSafeInteger(e.at) || e.at < 0) throw Error('invalid-permit-time');
  const proof = e.authorization;
  let p: PremisesPermit;
  if (e.type === 'PrincipalPremisesPermitOffered') {
    const t = e.terms;
    if (
      s.permits[t.id] ||
      !validPrincipalPremisesPermitTerms(t, e.at, s.policy) ||
      Object.keys(s.permits).length >= s.policy.maxPermits ||
      Object.values(s.permits).filter((p) => p.buildingId === t.buildingId).length >=
        s.policy.maxPermitsPerBuilding
    )
      throw Error('invalid-principal-permit-offer-event');
    const terms = {
      id: t.id,
      buildingId: t.buildingId,
      grantee: t.grantee,
      users: t.users,
      scopes: t.scopes,
      mode: t.mode,
      title: t.title,
      terms: t.terms,
      startAt: t.startAt,
      endAt: t.endAt,
      acceptBy: t.acceptBy,
    };
    const request: PrincipalOperationRequest = {
      resourceKind: 'premises',
      resourceId: t.buildingId,
      resourceRevision: proof.request.resourceRevision,
      controlVersion: t.issuerVersion,
      operation: {
        capability: 'permits.offer',
        arguments: { type: 'offer', terms, buildingRevision: proof.request.resourceRevision },
      },
    };
    assertPrincipalAuthorization(proof, t.issuer, request, proof.actorId);
    p = {
      ...structuredClone(t),
      principalAuthorization: { offered: structuredClone(proof) },
      offered: { actorId: proof.actorId, at: e.at },
      status: 'offered',
      revision: 1,
      at: e.at,
    };
  } else {
    const old = s.permits[e.id];
    if (
      !old ||
      !isPrincipalPremisesPermit(old) ||
      !('principalAuthorization' in old) ||
      old.closed ||
      e.revision !== old.revision + 1 ||
      !Number.isSafeInteger(e.revision) ||
      e.at < old.at
    )
      throw Error('invalid-principal-permit-transition');
    const command: PrincipalPremisesRightsCommand =
      e.type === 'PrincipalPremisesPermitAccepted' ||
      e.type === 'PrincipalPremisesPermitTradeAccepted'
        ? { type: 'accept', id: old.id, revision: old.revision }
        : e.reason === 'released'
          ? { type: 'release', id: old.id, revision: old.revision }
          : { type: 'withdraw', id: old.id, revision: old.revision, side: e.side };
    const request =
      e.type === 'PrincipalPremisesPermitTradeAccepted'
        ? principalPermitTradeRequest(e.binding)
        : principalPermitRequest(s, command, { building: () => undefined });
    const subject = principalPermitSubject(s, command, { building: () => undefined });
    assertPrincipalAuthorization(proof, subject, request, proof.actorId);
    if (
      e.type === 'PrincipalPremisesPermitAccepted' ||
      e.type === 'PrincipalPremisesPermitTradeAccepted'
    ) {
      if (
        old.status !== 'offered' ||
        e.at >= old.acceptBy ||
        conflictingPremisesPermit(s, { ...old, startAt: Math.max(old.startAt, e.at) })
      )
        throw Error('invalid-principal-permit-acceptance-event');
      p = {
        ...old,
        accepted: { actorId: proof.actorId, at: e.at },
        principalAuthorization: { ...old.principalAuthorization, accepted: structuredClone(proof) },
        status: 'accepted',
        revision: e.revision,
        at: e.at,
      };
    } else {
      if (
        e.reason === 'released'
          ? old.status !== 'accepted' || e.at >= old.endAt || e.side !== 'grantee'
          : e.reason !== 'withdrawn' ||
            old.status !== 'offered' ||
            !['issuer', 'grantee'].includes(e.side)
      )
        throw Error('invalid-principal-permit-closure-event');
      if (s.provisions?.[old.id] && s.provisions[old.id]!.settledAt < Math.min(e.at, old.endAt))
        throw Error('provision-must-settle-before-permit-closes');
      p = {
        ...old,
        closed: { actorId: proof.actorId, at: e.at, reason: e.reason },
        principalAuthorization: { ...old.principalAuthorization, closed: structuredClone(proof) },
        status: e.reason,
        revision: e.revision,
        at: e.at,
      };
    }
  }
  return { ...s, permits: { ...s.permits, [p.id]: p } };
}

import {
  authorizeController,
  effectiveController,
  controlVersion,
  sameController,
  validControllerId,
  type Controller,
} from '@aivilization/authority';
import { isPrincipalPremisesPermit } from './rightsModel';
import { conflictingPremisesPermit } from './rightsAccess';
import {
  assertPremisesRightsPolicy,
  validPermitSignature,
  validPremisesPermitTerms,
} from './rightsValidation';
import type {
  PremisesRightsState,
  PremisesRightsPorts,
  PremisesRightsCommand,
  PremisesRightsDecision,
  PremisesRightsEvent,
  PremisesPermit,
  PermitSignature,
} from './rightsModel';

const no = (reason: string): PremisesRightsDecision => ({ accepted: false, reason });
const yes = (...events: PremisesRightsEvent[]): PremisesRightsDecision => ({
  accepted: true,
  events,
});
export function decidePremisesRights(
  s: PremisesRightsState,
  actorId: string,
  at: number,
  c: PremisesRightsCommand,
  ports: PremisesRightsPorts,
): PremisesRightsDecision {
  if (!validControllerId(actorId) || !ports.exists(actorId) || !Number.isSafeInteger(at) || at < 0)
    return no('invalid-permit-actor-or-time');
  const signature = (controller: Controller): PermitSignature | undefined => {
    if (ports.actingFor && !sameController(ports.actingFor, controller)) return undefined;
    const grant = authorizeController(controller, actorId, ports.authorize);
    return grant
      ? { actorId, at, ...(grant.decisionId ? { decisionId: grant.decisionId } : {}) }
      : undefined;
  };
  if (c.type === 'offer') {
    if ('principalVersion' in c.terms) return no('principal-permit-operation-required');
    const b = ports.building(c.terms.buildingId);
    if (!b || b.status !== 'operational' || b.condition <= 0)
      return no('permit-building-unavailable');
    if (b.revision !== c.buildingRevision) return no('permit-building-revision-conflict');
    const principal = effectiveController(b);
    if (
      b.control.policyVersion === 'resource-principals-v2' ||
      (principal.kind !== 'resident' && principal.kind !== 'collective')
    )
      return no('principal-permit-issuer-not-connected');
    const issuer = { kind: principal.kind, id: principal.id },
      signed = signature(issuer);
    if (!signed) return no('permit-issuer-authority-required');
    const terms = { ...c.terms, issuer, issuerVersion: controlVersion(b) };
    if (
      !validPremisesPermitTerms(terms, at, s.policy) ||
      terms.users.some((id) => !ports.exists(id)) ||
      !ports.controllerAvailable(terms.grantee)
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
    return yes({ type: 'PremisesPermitOffered', terms, signature: signed });
  }
  const p = s.permits[c.id];
  if (!p) return no('permit-not-found');
  if (isPrincipalPremisesPermit(p)) return no('principal-permit-operation-required');
  if (p.revision !== c.revision) return no('permit-revision-conflict');
  if (at < p.at) return no('invalid-permit-time');
  if (c.type === 'accept') {
    if (p.status !== 'offered' || at >= p.acceptBy) return no('permit-offer-unavailable');
    const signed = signature(p.grantee);
    if (!signed || !ports.controllerAvailable(p.grantee))
      return no('permit-grantee-authority-required');
    const b = ports.building(p.buildingId);
    if (
      !b ||
      b.status !== 'operational' ||
      b.condition <= 0 ||
      controlVersion(b) !== p.issuerVersion ||
      !sameController(effectiveController(b), p.issuer)
    )
      return no('permit-control-changed');
    if (conflictingPremisesPermit(s, { ...p, startAt: Math.max(at, p.startAt) }))
      return no('permit-exclusive-conflict');
    const conflict = ports.conflict(p, at);
    if (conflict) return no(conflict);
    return yes({
      type: 'PremisesPermitAccepted',
      id: p.id,
      revision: p.revision + 1,
      signature: signed,
    });
  }
  if (c.type === 'release') {
    if (p.status !== 'accepted' || at >= p.endAt) return no('permit-not-active');
    const signed = signature(p.grantee);
    if (!signed) return no('permit-grantee-authority-required');
    const provision = s.provisions?.[p.id];
    if (provision && provision.settledAt < Math.min(at, p.endAt))
      return no('provision-must-settle-before-permit-closes');
    const blocked = ports.releaseBlocked(p, at);
    if (blocked) return no(blocked);
    return yes({
      type: 'PremisesPermitClosed',
      id: p.id,
      revision: p.revision + 1,
      reason: 'released',
      signature: signed,
    });
  }
  if (p.status !== 'offered') return no('permit-offer-unavailable');
  const signed = signature(p.issuer) ?? signature(p.grantee);
  if (!signed) return no('permit-party-authority-required');
  return yes({
    type: 'PremisesPermitClosed',
    id: p.id,
    revision: p.revision + 1,
    reason: 'withdrawn',
    signature: signed,
  });
}

/** Events encode final consent facts. Replay never re-runs current authorization or building policy. */
export function applyPremisesRightsEvent(
  s: PremisesRightsState | undefined,
  e: PremisesRightsEvent,
): PremisesRightsState {
  if (e.type === 'PremisesRightsEnabled') {
    if (s) throw Error('premises-rights-already-enabled');
    assertPremisesRightsPolicy(e.policy);
    return { policy: structuredClone(e.policy), permits: {} };
  }
  if (!s) throw Error('premises-rights-not-enabled');
  let p: PremisesPermit;
  if (e.type === 'PremisesPermitOffered') {
    if (
      'principalVersion' in e.terms ||
      s.permits[e.terms.id] ||
      !validPremisesPermitTerms(e.terms, e.signature.at, s.policy) ||
      !validPermitSignature(e.signature, e.terms.issuer) ||
      Object.keys(s.permits).length >= s.policy.maxPermits ||
      Object.values(s.permits).filter((p) => p.buildingId === e.terms.buildingId).length >=
        s.policy.maxPermitsPerBuilding
    )
      throw Error('invalid-permit-offer-event');
    p = {
      ...structuredClone(e.terms),
      offered: { ...e.signature },
      status: 'offered',
      revision: 1,
      at: e.signature.at,
    };
  } else {
    const old = s.permits[e.id];
    if (
      !old ||
      old.closed ||
      old.revision + 1 !== e.revision ||
      e.signature.at < old.at ||
      !validPermitSignature(e.signature)
    )
      throw Error('invalid-permit-transition');
    if (
      isPrincipalPremisesPermit(old) &&
      !(e.type === 'PremisesPermitClosed' && e.reason === 'expired')
    )
      throw Error('principal-permit-operation-required');
    if (e.type === 'PremisesPermitAccepted') {
      if (
        old.status !== 'offered' ||
        e.signature.at >= old.acceptBy ||
        isPrincipalPremisesPermit(old) ||
        !validPermitSignature(e.signature, old.grantee) ||
        conflictingPremisesPermit(s, { ...old, startAt: Math.max(old.startAt, e.signature.at) })
      )
        throw Error('invalid-permit-acceptance-event');
      p = {
        ...old,
        accepted: { ...e.signature },
        status: 'accepted',
        revision: e.revision,
        at: e.signature.at,
      };
    } else {
      const valid =
        e.reason === 'released'
          ? old.status === 'accepted' &&
            e.signature.at < old.endAt &&
            !isPrincipalPremisesPermit(old) &&
            validPermitSignature(e.signature, old.grantee)
          : e.reason === 'withdrawn'
            ? old.status === 'offered' &&
              ((!isPrincipalPremisesPermit(old) && validPermitSignature(e.signature, old.issuer)) ||
                (!isPrincipalPremisesPermit(old) && validPermitSignature(e.signature, old.grantee)))
            : e.reason === 'expired' &&
              e.signature.actorId === 'system' &&
              !e.signature.decisionId &&
              (old.status === 'offered'
                ? e.signature.at >= old.acceptBy
                : old.status === 'accepted' && e.signature.at >= old.endAt);
      if (!valid) throw Error('invalid-permit-closure-event');
      const provision = s.provisions?.[old.id];
      if (provision && provision.settledAt < Math.min(e.signature.at, old.endAt))
        throw Error('provision-must-settle-before-permit-closes');
      p = {
        ...old,
        closed: { ...e.signature, reason: e.reason },
        status: e.reason,
        revision: e.revision,
        at: e.signature.at,
      };
    }
  }
  return { ...s, permits: { ...s.permits, [p.id]: p } };
}
export function expirePremisesRights(
  s: PremisesRightsState | undefined,
  at: number,
): readonly PremisesRightsEvent[] {
  if (!Number.isSafeInteger(at) || at < 0) throw Error('invalid-permit-time');
  return Object.values(s?.permits ?? {})
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((p) =>
      p.status === 'offered' ? at >= p.acceptBy : p.status === 'accepted' && at >= p.endAt,
    )
    .map((p) => ({
      type: 'PremisesPermitClosed',
      id: p.id,
      revision: p.revision + 1,
      reason: 'expired',
      signature: { actorId: 'system', at },
    }));
}

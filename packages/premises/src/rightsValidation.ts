import {
  sameController,
  validController,
  validControllerId,
  samePrincipal,
  validResourcePrincipal,
} from '@aivilization/authority';
import {
  PREMISES_USE_SCOPES,
  type PremisesPermitTerms,
  type AnyPremisesPermitTerms,
  type PrincipalPremisesPermitTerms,
  PRINCIPAL_PREMISES_RIGHTS_POLICY,
  type PremisesRightsPolicy,
  type PermitSignature,
} from './rightsModel';

export function assertPremisesRightsPolicy(p: PremisesRightsPolicy) {
  if (
    p.version !== 'resident-premises-rights-v1' ||
    ![
      p.maxPermits,
      p.maxPermitsPerBuilding,
      p.maxUsers,
      p.maxTermsChars,
      p.maxOfferHorizonMs,
      p.maxTermMs,
    ].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    throw Error('invalid-premises-rights-policy');
}
export function validPremisesPermitTerms(
  t: PremisesPermitTerms,
  at: number,
  p: PremisesRightsPolicy,
) {
  return (
    validController(t.issuer) &&
    validController(t.grantee) &&
    !sameController(t.issuer, t.grantee) &&
    validCommonPremisesPermitTerms(t, at, p)
  );
}
export function validPrincipalPremisesPermitTerms(
  t: PrincipalPremisesPermitTerms,
  at: number,
  p: PremisesRightsPolicy,
) {
  return (
    t.principalVersion === PRINCIPAL_PREMISES_RIGHTS_POLICY.version &&
    validResourcePrincipal(t.issuer) &&
    validResourcePrincipal(t.grantee) &&
    !samePrincipal(t.issuer, t.grantee) &&
    validCommonPremisesPermitTerms(t, at, p)
  );
}
function validCommonPremisesPermitTerms(
  t: AnyPremisesPermitTerms,
  at: number,
  p: PremisesRightsPolicy,
) {
  return (
    validControllerId(t.id) &&
    validControllerId(t.buildingId) &&
    Number.isSafeInteger(t.issuerVersion) &&
    t.issuerVersion > 0 &&
    t.users.length > 0 &&
    t.users.length <= p.maxUsers &&
    new Set(t.users).size === t.users.length &&
    t.users.every(validControllerId) &&
    t.scopes.length > 0 &&
    t.scopes.length <= PREMISES_USE_SCOPES.length &&
    new Set(t.scopes).size === t.scopes.length &&
    t.scopes.every((v) => PREMISES_USE_SCOPES.includes(v)) &&
    ['shared', 'exclusive'].includes(t.mode) &&
    !(t.mode === 'exclusive' && t.scopes.includes('entry')) &&
    !!t.title.trim() &&
    t.title.length <= 120 &&
    !!t.terms.trim() &&
    t.terms.length <= p.maxTermsChars &&
    [t.startAt, t.endAt, t.acceptBy].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    t.startAt >= at &&
    t.endAt > t.startAt &&
    t.endAt - t.startAt <= p.maxTermMs &&
    t.acceptBy > at &&
    t.acceptBy <= t.endAt &&
    t.acceptBy - at <= p.maxOfferHorizonMs
  );
}
export function validPermitSignature(
  s: PermitSignature,
  controller?: PremisesPermitTerms['issuer'],
) {
  return (
    validControllerId(s.actorId) &&
    Number.isSafeInteger(s.at) &&
    s.at >= 0 &&
    (s.decisionId === undefined || validControllerId(s.decisionId)) &&
    (!controller ||
      (controller.kind === 'resident'
        ? s.actorId === controller.id && !s.decisionId
        : !!s.decisionId))
  );
}

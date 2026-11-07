import {
  assertPrincipalOperationRequest,
  samePrincipalOperation,
  type PrincipalOperationRequest,
} from './principalOperation';
/** A resource responsibility subject, never a substitute for a human body or an inferred legal status. */
export type ResourcePrincipal = {
  readonly kind: 'resident' | 'collective' | 'enterprise' | 'public';
  readonly id: string;
};
export const RESOURCE_PRINCIPAL_POLICY = {
  version: 'resource-principals-v2',
  maxOfferHorizonMs: 30 * 86400000,
  maxTermsChars: 2000,
} as const;
export type ResourcePrincipalPolicy = typeof RESOURCE_PRINCIPAL_POLICY;
export type PrincipalControlCommand =
  | {
      readonly type: 'offer';
      readonly target: ResourcePrincipal;
      readonly expiresAt: number;
      readonly terms: string;
    }
  | { readonly type: 'accept' | 'cancel' };
/** The application's grant must describe this whole operation, not a reusable "is manager" boolean. */
export type PrincipalControlRequest = {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly controlVersion: number;
  readonly command: PrincipalControlCommand;
};
export type PrincipalAuthoritySource =
  | { readonly kind: 'personal' }
  | SuccessionControlOfferSource
  | { readonly kind: 'collective'; readonly decisionId: string; readonly charterVersion: number }
  | {
      readonly kind: 'enterprise';
      readonly managementVersion: number;
      readonly managementDecisionId: string | null;
    }
  | { readonly kind: 'public'; readonly proposalId: string; readonly procedureRevision: number };
/** Closed, explicitly versioned offer scope; the application corroborates actual succession facts atomically. */
export const SUCCESSION_CONTROL_OFFER_SOURCE_VERSION =
  'resident-succession-control-offer-v1' as const;
export type SuccessionControlOfferSource = {
  readonly kind: 'succession';
  readonly policyVersion: typeof SUCCESSION_CONTROL_OFFER_SOURCE_VERSION;
  readonly executionId: string;
  readonly arrangementId: string;
  readonly arrangementRevision: number;
  readonly termsRevision: number;
  readonly populationEventId: string;
  readonly beneficiaryId: string;
  readonly executedAt: number;
  readonly executeBefore: number;
};
export const successionControlOfferTerms = (
  source: Pick<
    SuccessionControlOfferSource,
    'arrangementId' | 'termsRevision' | 'populationEventId'
  >,
) =>
  JSON.stringify({
    purpose: 'original-succession-control-handover',
    arrangementId: source.arrangementId,
    termsRevision: source.termsRevision,
    populationEventId: source.populationEventId,
  });
export type PrincipalRequest = PrincipalControlRequest | PrincipalOperationRequest;
export type PrincipalAuthorization<R extends PrincipalRequest = PrincipalControlRequest> = {
  readonly actorId: string;
  readonly principal: ResourcePrincipal;
  readonly request: R;
  readonly source: PrincipalAuthoritySource;
};
export type PrincipalControlOffer = {
  readonly target: ResourcePrincipal;
  readonly expiresAt: number;
  readonly terms: string;
  readonly offeredAt: number;
  readonly authorization: PrincipalAuthorization;
};
export type PrincipalControl = {
  readonly policyVersion: typeof RESOURCE_PRINCIPAL_POLICY.version;
  readonly controller: ResourcePrincipal;
  readonly version: number;
  readonly at: number;
  readonly authorization: PrincipalAuthorization<PrincipalRequest>;
  readonly offer?: PrincipalControlOffer;
};
/** Includes legacy custody as an explicit read input. A v2 event is required to change it. */
export type PrincipalControlSnapshot = {
  readonly controller: ResourcePrincipal;
  readonly version: number;
  readonly at: number;
  readonly offer?: PrincipalControlOffer;
};
export type PrincipalControlChanged = {
  readonly type: 'ResourcePrincipalControlChanged';
  readonly policyVersion: typeof RESOURCE_PRINCIPAL_POLICY.version;
  readonly previousControlVersion: number;
  readonly request: PrincipalControlRequest;
  readonly control: PrincipalControl & { readonly authorization: PrincipalAuthorization };
};
export type PrincipalAuthorizationPort<R extends PrincipalRequest = PrincipalControlRequest> = (
  principal: ResourcePrincipal,
  request: R,
) => PrincipalAuthorization<R> | undefined;
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
export const principalId = (s: string) =>
  typeof s === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(s) &&
  !['__proto__', 'constructor', 'prototype'].includes(s);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]) =>
  object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
export const samePrincipal = (a: ResourcePrincipal, b: ResourcePrincipal) =>
  a.kind === b.kind && a.id === b.id;
export function validResourcePrincipal(p: ResourcePrincipal): boolean {
  return (
    exact(p, ['kind', 'id']) &&
    ['resident', 'collective', 'enterprise', 'public'].includes(p.kind) &&
    principalId(p.id)
  );
}
export function assertResourcePrincipalPolicy(p: ResourcePrincipalPolicy) {
  if (
    !exact(p, Object.keys(RESOURCE_PRINCIPAL_POLICY)) ||
    Object.entries(RESOURCE_PRINCIPAL_POLICY).some(
      ([k, v]) => p[k as keyof ResourcePrincipalPolicy] !== v,
    )
  )
    throw Error('unsupported-resource-principal-policy');
}
export function assertPrincipalControlRequest(r: PrincipalControlRequest) {
  if (
    !exact(r, ['resourceKind', 'resourceId', 'resourceRevision', 'controlVersion', 'command']) ||
    !principalId(r.resourceKind) ||
    !principalId(r.resourceId) ||
    !positive(r.resourceRevision) ||
    !positive(r.controlVersion)
  )
    throw Error('invalid-principal-control-request');
  const c = r.command;
  if (c.type === 'offer') {
    if (
      !exact(c, ['type', 'target', 'expiresAt', 'terms']) ||
      !validResourcePrincipal(c.target) ||
      !time(c.expiresAt) ||
      typeof c.terms !== 'string' ||
      !c.terms.trim() ||
      c.terms.length > RESOURCE_PRINCIPAL_POLICY.maxTermsChars
    )
      throw Error('invalid-principal-control-offer');
  } else if (!['accept', 'cancel'].includes(c.type) || !exact(c, ['type']))
    throw Error('invalid-principal-control-command');
}
function sameRequest(a: PrincipalControlRequest, b: PrincipalControlRequest) {
  if (
    a.resourceKind !== b.resourceKind ||
    a.resourceId !== b.resourceId ||
    a.resourceRevision !== b.resourceRevision ||
    a.controlVersion !== b.controlVersion ||
    a.command.type !== b.command.type
  )
    return false;
  return (
    a.command.type !== 'offer' ||
    (b.command.type === 'offer' &&
      samePrincipal(a.command.target, b.command.target) &&
      a.command.expiresAt === b.command.expiresAt &&
      a.command.terms === b.command.terms)
  );
}
/** Structure and exact operation binding only. The owning application must verify the actual referenced decision. */
export function assertPrincipalAuthorization<R extends PrincipalRequest>(
  a: PrincipalAuthorization<R>,
  principal: ResourcePrincipal,
  request: R,
  actorId: string,
) {
  assertPrincipalRequest(request);
  assertPrincipalRequest(a.request);
  if (
    !exact(a, ['actorId', 'principal', 'request', 'source']) ||
    !validResourcePrincipal(a.principal) ||
    !principalId(actorId) ||
    a.actorId !== actorId ||
    !samePrincipal(a.principal, principal) ||
    !samePrincipalRequest(a.request, request)
  )
    throw Error('principal-authority-scope-mismatch');
  const s = a.source;
  if (principal.kind === 'resident') {
    if (s.kind === 'succession') {
      if (
        !exact(s, [
          'kind',
          'policyVersion',
          'executionId',
          'arrangementId',
          'arrangementRevision',
          'termsRevision',
          'populationEventId',
          'beneficiaryId',
          'executedAt',
          'executeBefore',
        ]) ||
        s.policyVersion !== SUCCESSION_CONTROL_OFFER_SOURCE_VERSION ||
        ![s.executionId, s.arrangementId, s.populationEventId, s.beneficiaryId].every(
          principalId,
        ) ||
        !positive(s.arrangementRevision) ||
        !positive(s.termsRevision) ||
        s.termsRevision > s.arrangementRevision ||
        !time(s.executedAt) ||
        !time(s.executeBefore) ||
        s.executeBefore <= s.executedAt ||
        principal.id === actorId ||
        principal.id === s.beneficiaryId ||
        !('command' in request) ||
        request.command.type !== 'offer' ||
        !['stock', 'vehicle', 'premises', 'space', 'register', 'view', 'group', 'service'].includes(
          request.resourceKind,
        ) ||
        request.command.target.kind !== 'resident' ||
        request.command.target.id !== s.beneficiaryId ||
        request.command.expiresAt <= s.executedAt ||
        request.command.expiresAt > s.executeBefore ||
        request.command.terms !== successionControlOfferTerms(s)
      )
        throw Error('principal-succession-finite-offer-scope-required');
    } else if (s.kind !== 'personal' || !exact(s, ['kind']) || principal.id !== actorId)
      throw Error('principal-personal-consent-required');
  } else if (principal.kind === 'collective') {
    if (
      s.kind !== 'collective' ||
      !exact(s, ['kind', 'decisionId', 'charterVersion']) ||
      !principalId(s.decisionId) ||
      !positive(s.charterVersion)
    )
      throw Error('principal-collective-source-required');
  } else if (principal.kind === 'enterprise') {
    if (
      s.kind !== 'enterprise' ||
      !exact(s, ['kind', 'managementVersion', 'managementDecisionId']) ||
      !positive(s.managementVersion) ||
      (s.managementDecisionId !== null && !principalId(s.managementDecisionId))
    )
      throw Error('principal-enterprise-source-required');
  } else if (
    s.kind !== 'public' ||
    !exact(s, ['kind', 'proposalId', 'procedureRevision']) ||
    !principalId(s.proposalId) ||
    !positive(s.procedureRevision)
  )
    throw Error('principal-public-source-required');
}
export function decidePrincipalControl(input: {
  policy: ResourcePrincipalPolicy;
  snapshot: PrincipalControlSnapshot;
  request: PrincipalControlRequest;
  actorId: string;
  at: number;
  authorize: PrincipalAuthorizationPort;
  available: (p: ResourcePrincipal) => boolean;
}) {
  const { snapshot: s, request: r, actorId, at } = input;
  const no = (reason: string) => ({ accepted: false as const, reason });
  try {
    assertResourcePrincipalPolicy(input.policy);
    assertPrincipalControlRequest(r);
  } catch (e) {
    return no(e instanceof Error ? e.message : 'invalid-principal-control');
  }
  if (
    !validResourcePrincipal(s.controller) ||
    !positive(s.version) ||
    !time(s.at) ||
    !time(at) ||
    at < s.at ||
    !principalId(actorId) ||
    !input.available({ kind: 'resident', id: actorId })
  )
    return no('invalid-principal-control-source');
  if (r.controlVersion !== s.version) return no('principal-control-version-conflict');
  if (s.version >= Number.MAX_SAFE_INTEGER) return no('principal-control-version-limit');
  const c = r.command,
    subject = c.type === 'accept' ? s.offer?.target : s.controller;
  if (!subject) return no('principal-control-offer-missing');
  const authorization = input.authorize(subject, structuredClone(r));
  if (!authorization) return no('principal-control-authority-required');
  try {
    assertPrincipalAuthorization(authorization, subject, r, actorId);
  } catch (e) {
    return no(e instanceof Error ? e.message : 'invalid-principal-authorization');
  }
  if (
    authorization.source.kind === 'succession' &&
    (authorization.source.executedAt !== at || s.offer)
  )
    return no('principal-succession-current-time-and-empty-offer-required');
  if (c.type === 'offer') {
    if (samePrincipal(c.target, s.controller) || !input.available(c.target))
      return no('principal-control-target-unavailable');
    if (c.expiresAt <= at || c.expiresAt - at > input.policy.maxOfferHorizonMs)
      return no('invalid-principal-control-offer-time');
  } else if (!s.offer) return no('principal-control-offer-missing');
  else if (c.type === 'accept' && (at >= s.offer.expiresAt || !input.available(s.offer.target)))
    return no('principal-control-offer-expired-or-unavailable');
  const control: PrincipalControl & { readonly authorization: PrincipalAuthorization } = {
    policyVersion: input.policy.version,
    controller: structuredClone(c.type === 'accept' ? s.offer!.target : s.controller),
    version: s.version + 1,
    at,
    authorization: structuredClone(authorization),
    ...(c.type === 'offer'
      ? {
          offer: {
            target: structuredClone(c.target),
            terms: c.terms,
            expiresAt: c.expiresAt,
            offeredAt: at,
            authorization: structuredClone(authorization),
          },
        }
      : {}),
  };
  const event: PrincipalControlChanged = {
    type: 'ResourcePrincipalControlChanged',
    policyVersion: input.policy.version,
    previousControlVersion: s.version,
    request: structuredClone(r),
    control,
  };
  return { accepted: true as const, event };
}
/** Replay checks the facts and the frozen operation; it never consults current governance or management rules. */
export function applyPrincipalControl(
  s: PrincipalControlSnapshot,
  e: PrincipalControlChanged,
): PrincipalControl {
  const c = e.control,
    r = e.request;
  assertPrincipalControlRequest(r);
  if (
    e.type !== 'ResourcePrincipalControlChanged' ||
    e.policyVersion !== RESOURCE_PRINCIPAL_POLICY.version ||
    c.policyVersion !== e.policyVersion ||
    e.previousControlVersion !== s.version ||
    r.controlVersion !== s.version ||
    c.version !== s.version + 1 ||
    !positive(c.version) ||
    !time(c.at) ||
    c.at < s.at ||
    !validResourcePrincipal(c.controller)
  )
    throw Error('invalid-principal-control-event');
  const subject = r.command.type === 'accept' ? s.offer?.target : s.controller;
  if (!subject) throw Error('principal-control-offer-missing');
  assertPrincipalAuthorization(c.authorization, subject, r, c.authorization.actorId);
  if (
    c.authorization.source.kind === 'succession' &&
    (c.authorization.source.executedAt !== c.at || s.offer)
  )
    throw Error('principal-succession-current-time-and-empty-offer-required');
  if (r.command.type === 'offer') {
    const o = c.offer;
    if (
      !o ||
      !samePrincipal(c.controller, s.controller) ||
      !samePrincipal(o.target, r.command.target) ||
      samePrincipal(o.target, s.controller) ||
      o.expiresAt !== r.command.expiresAt ||
      o.terms !== r.command.terms ||
      o.offeredAt !== c.at ||
      o.expiresAt <= c.at ||
      o.expiresAt - c.at > RESOURCE_PRINCIPAL_POLICY.maxOfferHorizonMs
    )
      throw Error('invalid-principal-control-offer-event');
    assertPrincipalAuthorization(o.authorization, subject, r, c.authorization.actorId);
    if (!samePrincipalAuthoritySource(o.authorization.source, c.authorization.source))
      throw Error('principal-control-offer-proof-mismatch');
  } else if (
    !s.offer ||
    c.offer !== undefined ||
    (r.command.type === 'accept'
      ? c.at >= s.offer.expiresAt || !samePrincipal(c.controller, s.offer.target)
      : !samePrincipal(c.controller, s.controller))
  )
    throw Error('invalid-principal-control-resolution-event');
  return structuredClone(c);
}
function samePrincipalAuthoritySource(
  a: PrincipalAuthoritySource,
  b: PrincipalAuthoritySource,
): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'personal':
      return true;
    case 'succession':
      return (
        b.kind === 'succession' &&
        a.policyVersion === b.policyVersion &&
        a.executionId === b.executionId &&
        a.arrangementId === b.arrangementId &&
        a.arrangementRevision === b.arrangementRevision &&
        a.termsRevision === b.termsRevision &&
        a.populationEventId === b.populationEventId &&
        a.beneficiaryId === b.beneficiaryId &&
        a.executedAt === b.executedAt &&
        a.executeBefore === b.executeBefore
      );
    case 'collective':
      return (
        b.kind === 'collective' &&
        a.decisionId === b.decisionId &&
        a.charterVersion === b.charterVersion
      );
    case 'enterprise':
      return (
        b.kind === 'enterprise' &&
        a.managementVersion === b.managementVersion &&
        a.managementDecisionId === b.managementDecisionId
      );
    case 'public':
      return (
        b.kind === 'public' &&
        a.proposalId === b.proposalId &&
        a.procedureRevision === b.procedureRevision
      );
  }
}

export function assertPrincipalRequest(r: PrincipalRequest) {
  if ('operation' in r) assertPrincipalOperationRequest(r);
  else assertPrincipalControlRequest(r);
}
export function samePrincipalRequest(a: PrincipalRequest, b: PrincipalRequest): boolean {
  if ('operation' in a) return 'operation' in b && samePrincipalOperation(a, b);
  return !('operation' in b) && sameRequest(a, b);
}

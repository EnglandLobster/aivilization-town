import type { PrincipalControl, ResourcePrincipal } from './principal';
/** Control is separate from authorship, resource usage ACL and physical ownership obligations. */
export const RESOURCE_CONTROL_POLICY = {
  version: 'resource-control-v1',
  maxOfferHorizonMs: 30 * 86400000,
  maxTermsChars: 2000,
} as const;
export type ResourceControlPolicy = {
  readonly version: 'resource-control-v1';
  readonly maxOfferHorizonMs: number;
  readonly maxTermsChars: number;
};
export type Controller = { readonly kind: 'resident' | 'collective'; readonly id: string };
export type ControlAuthorization = { readonly actorId: string; readonly decisionId?: string };
export type ControlOffer = {
  readonly target: Controller;
  readonly expiresAt: number;
  readonly terms: string;
  readonly offeredBy: string;
  readonly offeredAt: number;
  readonly decisionId?: string;
};
export type ResourceControl = {
  readonly policyVersion: ResourceControlPolicy['version'];
  readonly controller: Controller;
  readonly version: number;
  readonly at: number;
  readonly changedBy: string;
  readonly decisionId?: string;
  readonly offer?: ControlOffer;
};
export type ControlledResource = {
  readonly ownerId: string;
  readonly control?: ResourceControl | PrincipalControl;
};
export type LegacyControlledResource = {
  readonly ownerId: string;
  readonly control?: ResourceControl;
};
export type ControlCommand =
  | {
      readonly type: 'offer';
      readonly expectedVersion: number;
      readonly target: Controller;
      readonly expiresAt: number;
      readonly terms: string;
    }
  | { readonly type: 'accept'; readonly expectedVersion: number }
  | { readonly type: 'cancel'; readonly expectedVersion: number };
/** Application binds this port to one exact resource/operation and authenticated execution. Never a CLI argument. */
export type ControlAuthorizationPort = (controller: Controller) => ControlAuthorization | undefined;
export const validControllerId = (id: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id) && !Object.hasOwn(Object.prototype, id);
export const validController = (c: Controller) =>
  ['resident', 'collective'].includes(c.kind) && validControllerId(c.id);
export const sameController = (a: ResourcePrincipal, b: ResourcePrincipal) =>
  a.kind === b.kind && a.id === b.id;
export function effectiveController(r: LegacyControlledResource): Controller;
export function effectiveController(r: ControlledResource): ResourcePrincipal;
export function effectiveController(r: ControlledResource): ResourcePrincipal {
  return r.control?.controller ?? { kind: 'resident', id: r.ownerId };
}
export const controlVersion = (r: ControlledResource) => r.control?.version ?? 1;
export const personallyControls = (r: ControlledResource, actor: string) =>
  sameController(effectiveController(r), { kind: 'resident', id: actor });
export const personalControlAuthorization =
  (actorId: string): ControlAuthorizationPort =>
  (c) =>
    c.kind === 'resident' && c.id === actorId ? { actorId } : undefined;
export function resourceAdministration(
  r: ControlledResource,
  actorId: string,
  port?: ControlAuthorizationPort,
): ControlAuthorization | undefined {
  if (r.control?.policyVersion === 'resource-principals-v2') return undefined;
  const subject = effectiveController(r);
  if (subject.kind !== 'resident' && subject.kind !== 'collective') return undefined;
  return authorizeController(
    { kind: subject.kind, id: subject.id },
    actorId,
    port ?? (() => undefined),
  );
}
export function assertResourceControlPolicy(p: ResourceControlPolicy) {
  if (
    p.version !== RESOURCE_CONTROL_POLICY.version ||
    ![p.maxOfferHorizonMs, p.maxTermsChars].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    throw new Error('invalid-resource-control-policy');
}
export function authorizeController(
  subject: Controller,
  actorId: string,
  port: ControlAuthorizationPort,
): ControlAuthorization | undefined {
  if (subject.kind === 'resident') return subject.id === actorId ? { actorId } : undefined;
  const grant = port(subject);
  return grant?.actorId === actorId &&
    typeof grant.decisionId === 'string' &&
    validControllerId(grant.decisionId)
    ? grant
    : undefined;
}
export function decideResourceControl(input: {
  resource: ControlledResource;
  actorId: string;
  at: number;
  command: ControlCommand;
  policy: ResourceControlPolicy;
  authorize: ControlAuthorizationPort;
  available: (c: Controller) => boolean;
}) {
  const { resource: r, actorId, at, command: c, policy } = input;
  assertResourceControlPolicy(policy);
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (r.control?.policyVersion === 'resource-principals-v2')
    return no('versioned-principal-control-required');
  const legacy: LegacyControlledResource = {
    ownerId: r.ownerId,
    ...(r.control ? { control: r.control } : {}),
  };
  if (
    !validControllerId(actorId) ||
    !input.available({ kind: 'resident', id: actorId }) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    at < (r.control?.at ?? 0)
  )
    return no('invalid-control-actor-or-time');
  if (c.expectedVersion !== controlVersion(r)) return no('control-version-conflict');
  if (c.expectedVersion >= Number.MAX_SAFE_INTEGER) return no('control-version-limit');
  const controller = effectiveController(legacy),
    offer = legacy.control?.offer;
  const subject = c.type === 'accept' ? offer?.target : controller;
  if (!subject) return no('control-offer-not-found');
  const grant = authorizeController(subject, actorId, input.authorize);
  if (!grant) return no('resource-controller-authority-required');
  const base = {
    policyVersion: policy.version,
    version: c.expectedVersion + 1,
    at,
    changedBy: actorId,
    ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
  };
  if (c.type === 'cancel') {
    if (!offer) return no('control-offer-not-found');
    return { accepted: true as const, control: { ...base, controller } satisfies ResourceControl };
  }
  if (c.type === 'accept') {
    if (!offer || at >= offer.expiresAt) return no('control-offer-expired');
    if (!input.available(offer.target)) return no('controller-unavailable');
    return {
      accepted: true as const,
      control: { ...base, controller: offer.target } satisfies ResourceControl,
    };
  }
  if (
    !validController(c.target) ||
    sameController(c.target, controller) ||
    !input.available(c.target)
  )
    return no('invalid-control-target');
  if (
    !Number.isSafeInteger(c.expiresAt) ||
    c.expiresAt <= at ||
    c.expiresAt > at + policy.maxOfferHorizonMs ||
    !c.terms.trim() ||
    c.terms.length > policy.maxTermsChars
  )
    return no('invalid-control-offer');
  return {
    accepted: true as const,
    control: {
      ...base,
      controller,
      offer: {
        target: { ...c.target },
        expiresAt: c.expiresAt,
        terms: c.terms,
        offeredBy: actorId,
        offeredAt: at,
        ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
      },
    } satisfies ResourceControl,
  };
}
/** Existing resource administrators use this on settings changes; it invalidates any outstanding offer. */
export function revisedResourceControl(
  r: ControlledResource,
  authorization: ControlAuthorization,
  at: number,
): ResourceControl | undefined {
  if (r.control?.policyVersion === 'resource-principals-v2')
    throw Error('versioned-principal-administration-required');
  if (!r.control) return undefined; // Preserve old event shape for resources that have never opted in.
  if (r.control.version >= Number.MAX_SAFE_INTEGER) throw new Error('control-version-limit');
  return {
    controller: r.control.controller,
    policyVersion: r.control.policyVersion,
    version: r.control.version + 1,
    changedBy: authorization.actorId,
    at,
    ...(authorization.decisionId ? { decisionId: authorization.decisionId } : {}),
  };
}

/** Creating an empty resource records only its authenticated creator's own control. */
export function initialResourceControl(
  actorId: string,
  at: number,
  policy: ResourceControlPolicy,
): ResourceControl {
  assertResourceControlPolicy(policy);
  if (!validControllerId(actorId) || !Number.isSafeInteger(at) || at < 0)
    throw new Error('invalid-control-actor-or-time');
  return {
    policyVersion: policy.version,
    controller: { kind: 'resident', id: actorId },
    version: 1,
    changedBy: actorId,
    at,
  };
}

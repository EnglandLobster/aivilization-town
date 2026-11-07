import {
  RESOURCE_CONTROL_POLICY,
  assertResourceControlTransition,
  controlVersion,
  effectiveController,
  decideResourceControl,
  resourceAdministration,
  sameController,
  validControllerId,
  validController,
  type ResourceControl,
  type ControlCommand,
  type Controller,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import type { EnterpriseState } from './model';

export const ENTERPRISE_CONTROL_VERSION = 'resident-enterprise-control-v1';
export type EnterpriseControlEvent = {
  readonly type: 'EnterpriseControlChanged';
  readonly policyVersion: typeof ENTERPRISE_CONTROL_VERSION;
  readonly enterpriseId: string;
  readonly operation: ControlCommand['type'];
  readonly control: ResourceControl;
};
/** Identity/history and capital rights remain on EnterpriseState; control only owns management. */
export const enterpriseControlResource = (e: EnterpriseState) => ({
  ownerId: String(e.ownerAgentId),
  ...(e.control ? { control: e.control } : {}),
});
export const enterpriseController = (e: EnterpriseState): Controller =>
  effectiveController(enterpriseControlResource(e));
export const enterpriseControlVersion = (e: EnterpriseState): number =>
  controlVersion(enterpriseControlResource(e));
export const enterpriseRequiresManagement = (e: EnterpriseState): boolean =>
  !!(e.control || e.capital);
export type EnterpriseManagementOperation =
  | 'resource-control'
  | 'activate-capital'
  | 'post-job'
  | 'offer-labor-terms'
  | 'layoff'
  | 'close'
  | 'trade'
  | 'export'
  | 'import'
  | 'produce'
  | 'authorize-production'
  | 'authorize-service'
  | 'revoke-service'
  | 'fund-service'
  | 'cancel-service';
export type EnterpriseManagementAuthority = {
  readonly policyVersion: typeof ENTERPRISE_CONTROL_VERSION;
  readonly enterpriseId: string;
  readonly controlVersion: number;
  readonly controller: Controller;
  readonly actorId: string;
  readonly operation: EnterpriseManagementOperation;
  readonly decisionId?: string;
};
/** The port is supplied by an authenticated application, scoped to one exact approved action. */
export function enterpriseManagementAuthority(
  e: EnterpriseState,
  actorId: string,
  operation: EnterpriseManagementOperation,
  authorize?: ControlAuthorizationPort,
): EnterpriseManagementAuthority | undefined {
  const grant = resourceAdministration(enterpriseControlResource(e), actorId, authorize);
  if (!grant) return undefined;
  return {
    policyVersion: ENTERPRISE_CONTROL_VERSION,
    enterpriseId: e.enterpriseId,
    controlVersion: enterpriseControlVersion(e),
    controller: enterpriseController(e),
    actorId,
    operation,
    ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
  };
}
/** Replay checks the recorded actor/controller/version; collective consumption belongs to the atomic application commit. */
export function assertEnterpriseManagementAuthority(
  e: EnterpriseState,
  authority: EnterpriseManagementAuthority | undefined,
  operation: EnterpriseManagementOperation,
) {
  if (
    !authority ||
    authority.policyVersion !== ENTERPRISE_CONTROL_VERSION ||
    authority.enterpriseId !== e.enterpriseId ||
    authority.operation !== operation ||
    authority.controlVersion !== enterpriseControlVersion(e) ||
    !validControllerId(authority.actorId) ||
    !sameController(authority.controller, enterpriseController(e)) ||
    (authority.controller.kind === 'resident'
      ? authority.actorId !== authority.controller.id || authority.decisionId !== undefined
      : !authority.decisionId || !validControllerId(authority.decisionId))
  )
    throw Error('enterprise-management-authority-mismatch');
}
export function decideEnterpriseControl(input: {
  enterprise: EnterpriseState;
  actorId: string;
  at: number;
  command: ControlCommand;
  authorize: ControlAuthorizationPort;
  available: (controller: Controller) => boolean;
}) {
  const e = input.enterprise;
  if (e.status === 'closed' || input.at < e.foundedAt)
    return { accepted: false as const, reason: 'enterprise-control-unavailable' };
  const d = decideResourceControl({
    resource: enterpriseControlResource(e),
    actorId: input.actorId,
    at: input.at,
    command: input.command,
    policy: RESOURCE_CONTROL_POLICY,
    authorize: input.authorize,
    available: input.available,
  });
  if (!d.accepted) return d;
  const event: EnterpriseControlEvent = {
    type: 'EnterpriseControlChanged',
    policyVersion: ENTERPRISE_CONTROL_VERSION,
    enterpriseId: e.enterpriseId,
    operation: input.command.type,
    control: d.control,
  };
  applyEnterpriseControlEvent(e, event);
  return { accepted: true as const, event };
}
export function applyEnterpriseControlEvent(
  e: EnterpriseState,
  event: EnterpriseControlEvent,
): EnterpriseState {
  if (
    event.type !== 'EnterpriseControlChanged' ||
    event.policyVersion !== ENTERPRISE_CONTROL_VERSION ||
    event.enterpriseId !== e.enterpriseId ||
    e.status === 'closed' ||
    event.control.at < e.foundedAt
  )
    throw Error('enterprise-control-source-mismatch');
  assertResourceControlTransition(
    enterpriseControlResource(e),
    event.control,
    event.operation,
    RESOURCE_CONTROL_POLICY,
  );
  return { ...e, control: structuredClone(event.control) };
}

/** Snapshot validation does not invent a historical transfer for existing control. */
export function assertEnterpriseControlState(e: EnterpriseState) {
  const c = e.control;
  if (!c) return;
  if (
    c.policyVersion !== RESOURCE_CONTROL_POLICY.version ||
    !Number.isSafeInteger(c.version) ||
    c.version < 2 ||
    !Number.isSafeInteger(c.at) ||
    c.at < e.foundedAt ||
    !validController(c.controller) ||
    !validControllerId(c.changedBy) ||
    (c.controller.kind === 'resident'
      ? c.changedBy !== c.controller.id || c.decisionId !== undefined
      : !c.decisionId || !validControllerId(c.decisionId))
  )
    throw Error('invalid-enterprise-control-state');
  const o = c.offer;
  if (
    o &&
    (!validController(o.target) ||
      sameController(o.target, c.controller) ||
      o.offeredBy !== c.changedBy ||
      o.offeredAt !== c.at ||
      o.decisionId !== c.decisionId ||
      !Number.isSafeInteger(o.expiresAt) ||
      o.expiresAt <= c.at ||
      o.expiresAt > c.at + RESOURCE_CONTROL_POLICY.maxOfferHorizonMs ||
      typeof o.terms !== 'string' ||
      !o.terms.trim() ||
      o.terms.length > RESOURCE_CONTROL_POLICY.maxTermsChars)
  )
    throw Error('invalid-enterprise-control-offer');
}

/** Legacy membership privileges stay on old firms; explicit control requires actual management authority. */
export function enterpriseMayOperate(
  e: EnterpriseState,
  actorId: string,
  operation: EnterpriseManagementOperation,
  authorize?: ControlAuthorizationPort,
): boolean {
  return enterpriseRequiresManagement(e)
    ? !!enterpriseManagementAuthority(e, actorId, operation, authorize)
    : e.ownerAgentId === actorId || e.employeeAgentIds.some((id) => id === actorId);
}

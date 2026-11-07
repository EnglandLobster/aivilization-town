import {
  assertPrincipalAuthorization,
  type PrincipalAuthorization,
  type PrincipalRequest,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  enterpriseManagementAuthority,
  enterpriseController,
  enterpriseControlVersion,
} from './control';
import type { EnterpriseState } from './model';
/** Enterprise asset custody cannot be inferred from employment or ownership shares. The scoped port is application-owned. */
export function authorizeEnterpriseResourceControl<R extends PrincipalRequest>(input: {
  enterprise: EnterpriseState;
  actorId: string;
  request: R;
  authorize?: ControlAuthorizationPort;
}): PrincipalAuthorization<R> | undefined {
  const e = input.enterprise;
  // Insolvency/estate disposition needs its own settlement authority, not an unconstrained new grant.
  if (e.status !== 'active') return undefined;
  const management = enterpriseManagementAuthority(
    e,
    input.actorId,
    'resource-control',
    input.authorize,
  );
  if (!management) return undefined;
  const a: PrincipalAuthorization<R> = {
    actorId: input.actorId,
    principal: { kind: 'enterprise', id: e.enterpriseId },
    request: structuredClone(input.request),
    source: {
      kind: 'enterprise',
      managementVersion: management.controlVersion,
      managementDecisionId: management.decisionId ?? null,
    },
  };
  assertEnterpriseResourceControlSource(e, a, input.request, input.actorId);
  return a;
}
/** The atomic world transaction separately validates and consumes a referenced collective decision. */
export function assertEnterpriseResourceControlSource<R extends PrincipalRequest>(
  e: EnterpriseState,
  a: PrincipalAuthorization<R>,
  request: R,
  actorId: string,
) {
  assertPrincipalAuthorization(a, { kind: 'enterprise', id: e.enterpriseId }, request, actorId);
  const s = a.source,
    controller = enterpriseController(e);
  if (
    e.status !== 'active' ||
    s.kind !== 'enterprise' ||
    s.managementVersion !== enterpriseControlVersion(e) ||
    (controller.kind === 'resident'
      ? controller.id !== actorId || s.managementDecisionId !== null
      : s.managementDecisionId === null)
  )
    throw Error('enterprise-resource-control-source-mismatch');
}

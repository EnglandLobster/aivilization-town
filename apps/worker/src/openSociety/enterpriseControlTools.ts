import {
  enterpriseController,
  enterpriseControlVersion,
  type EnterpriseState,
} from '@aivilization/enterprise';
import {
  personalControlAuthorization,
  sameController,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { enterpriseControlEvent } from '@aivilization/world';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { controllerAvailable, controllerVisibleTo } from './resourceControlAccess';
import { parseResourceControlArguments } from './resourceControlArguments';
import { ToolRefusal, stringArg } from './arguments';
import { applyOpenSocietyEffects } from './state';
import { digest } from './journal';
export function enterpriseControlMetadata(e: EnterpriseState) {
  return {
    kind: 'enterprise' as const,
    id: e.enterpriseId,
    title: e.name,
    revision: enterpriseControlVersion(e),
    controlVersion: enterpriseControlVersion(e),
    controller: enterpriseController(e),
    founderId: e.ownerAgentId,
    capitalShares: e.ownershipShares ?? { [e.ownerAgentId]: 1 },
    status: e.status,
    ...(e.control?.offer ? { offer: e.control.offer } : {}),
    note: 'Revision here means management control. Assets, capital rights, employees and earned wages do not transfer with management.',
    readWith: `town resources read --kind enterprise --id ${e.enterpriseId}`,
  };
}
const visible = (s: OpenSocietyState, e: EnterpriseState, a: string) =>
  controllerVisibleTo(s, enterpriseController(e), a) ||
  (!!e.control?.offer && controllerVisibleTo(s, e.control.offer.target, a)) ||
  (e.ownershipShares?.[a] ?? (e.ownerAgentId === a ? 1 : 0)) > 0 ||
  e.employeeAgentIds.some((id) => id === a);
export const visibleEnterpriseResources = (s: OpenSocietyState, a: string) =>
  Object.values(s.world.enterprises)
    .filter((e) => visible(s, e, a))
    .map(enterpriseControlMetadata);
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  name: string,
  id: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorize: ControlAuthorizationPort,
): ToolExecution {
  if (!s.resourceControlPolicy) throw new ToolRefusal('resource-control-not-enabled');
  const e = s.world.enterprises[id],
    parsed = parseResourceControlArguments(name, args);
  if (!e || !parsed) throw new ToolRefusal('invalid-enterprise-control-action');
  if (parsed.expectedRevision !== enterpriseControlVersion(e))
    throw new ToolRefusal('enterprise-control-revision-conflict');
  const d = enterpriseControlEvent({
    projection: s.world,
    actorId: a,
    enterpriseId: id,
    command: parsed.control,
    authorize,
    available: (c) => controllerAvailable(s, c),
    simulationId: m.simulationId,
    requestId: `enterprise-control-${digest([a, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  const effects = { worldEvents: d.events },
    after = applyOpenSocietyEffects(s, effects);
  return { data: enterpriseControlMetadata(after.world.enterprises[id]!), effects };
}
export function executeEnterpriseControlTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const id = stringArg(args, 'id'),
    e = s.world.enterprises[id];
  if (!e || !visible(s, e, a)) throw new ToolRefusal('enterprise-control-not-found');
  if (name === 'resources.read') return { data: enterpriseControlMetadata(e), effects: {} };
  const { id: _id, kind: _kind, ...parameters } = args;
  void _id;
  void _kind;
  return execute(s, m, a, name, id, parameters, requestId, personalControlAuthorization(a));
}
export function validateEnterpriseControlResource(
  s: OpenSocietyState,
  collectiveId: string,
  action: CollectiveResourceAction,
): string | undefined {
  if (!s.resourceControlPolicy || action.arguments.kind !== 'enterprise')
    return 'enterprise-control-not-enabled';
  const { kind: _kind, ...parameters } = action.arguments;
  void _kind;
  const e = s.world.enterprises[action.resourceId],
    parsed = parseResourceControlArguments(action.capability, parameters);
  if (!e || !parsed) return 'invalid-enterprise-control-action';
  const controller =
    parsed.control.type === 'accept' ? e.control?.offer?.target : enterpriseController(e);
  if (!controller || !sameController(controller, { kind: 'collective', id: collectiveId }))
    return 'collective-does-not-control-enterprise';
  if (
    parsed.expectedRevision !== enterpriseControlVersion(e) ||
    parsed.control.expectedVersion !== enterpriseControlVersion(e)
  )
    return 'enterprise-control-revision-conflict';
  return undefined;
}
export function executeApprovedEnterpriseControl(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actor: string,
  collectiveId: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
) {
  const error = validateEnterpriseControlResource(s, collectiveId, action);
  if (error) throw new ToolRefusal(error);
  const { kind: _kind, ...parameters } = action.arguments;
  void _kind;
  return execute(s, m, actor, action.capability, action.resourceId, parameters, requestId, (c) =>
    sameController(c, { kind: 'collective', id: collectiveId })
      ? { actorId: actor, decisionId }
      : undefined,
  );
}

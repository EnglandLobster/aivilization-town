import { executeEnterpriseControlTool, visibleEnterpriseResources } from './enterpriseControlTools';
import { parseResourceControlArguments } from './resourceControlArguments';
import { controllerAvailable, controllerVisibleTo } from './resourceControlAccess';
import {
  effectiveController,
  controlVersion,
  sameController,
  personalControlAuthorization,
  type ControlCommand,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import {
  allInformationResources,
  getInformationResource,
  informationResourceMetadata,
  parseInformationResourceOperation,
  decideInformationResourceControl,
  decideInformationResourceManagement,
  type InformationResourceKind,
  type InformationResourceOperation,
  type InformationResources,
} from '@aivilization/information';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { ToolRefusal, pageItems, stringArg } from './arguments';
import { applyOpenSocietyEffects } from './state';
const snapshot = (s: OpenSocietyState, m: OpenSocietyManifest): InformationResources => ({
  information: s.information,
  informationPolicy: m.informationPolicy,
  ...(s.communication ? { communication: s.communication } : {}),
  ...(s.sharedRecords ? { sharedRecords: s.sharedRecords } : {}),
});
const exact = (v: Readonly<Record<string, unknown>>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const kindOf = (v: unknown): InformationResourceKind | undefined =>
  v === 'space' || v === 'register' || v === 'group' ? v : undefined;
type ResourceAction = {
  readonly kind: InformationResourceKind;
  readonly expectedRevision: number;
  readonly expectedControlVersion: number;
} & ({ readonly control: ControlCommand } | { readonly operation: InformationResourceOperation });
function parseAction(
  name: string,
  args: Readonly<Record<string, unknown>>,
): ResourceAction | undefined {
  const kind = kindOf(args.kind),
    baseKeys = ['kind', 'expectedRevision', 'expectedControlVersion'];
  if (!kind || !integer(args.expectedRevision) || !integer(args.expectedControlVersion))
    return undefined;
  const base = {
    kind,
    expectedRevision: args.expectedRevision,
    expectedControlVersion: args.expectedControlVersion,
  };
  if (name === 'resources.manage' && exact(args, [...baseKeys, 'operation'])) {
    const operation = parseInformationResourceOperation(kind, args.operation);
    return operation ? { ...base, operation } : undefined;
  }
  const { kind: _kind, ...parameters } = args;
  void _kind;
  const command = parseResourceControlArguments(name, parameters);
  return command ? { ...base, control: command.control } : undefined;
}
function executeAction(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  id: string,
  action: ResourceAction,
  authorize: ControlAuthorizationPort,
): ToolExecution {
  const policy = state.resourceControlPolicy;
  if (!policy) throw new ToolRefusal('resource-control-not-enabled');
  const resources = snapshot(state, manifest),
    shared = {
      state: resources,
      id,
      actorId,
      at: state.world.clock.now,
      expectedRevision: action.expectedRevision,
      authorize,
    };
  const d =
    'control' in action
      ? decideInformationResourceControl({
          ...shared,
          kind: action.kind,
          policy,
          command: action.control,
          available: (c) => controllerAvailable(state, c),
        })
      : decideInformationResourceManagement({
          ...shared,
          expectedControlVersion: action.expectedControlVersion,
          operation: action.operation,
          exists: (id) => Object.hasOwn(state.world.agents, id),
        });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  const after = applyOpenSocietyEffects(state, d.effects),
    r = getInformationResource(snapshot(after, manifest), action.kind, id)!;
  return { data: informationResourceMetadata(action.kind, r), effects: d.effects };
}
export function validateInformationResourceAction(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  collectiveId: string,
  action: CollectiveResourceAction,
): string | undefined {
  if (!state.resourceControlPolicy) return 'resource-control-not-enabled';
  const parsed = parseAction(action.capability, action.arguments);
  if (!parsed) return 'unsupported-or-invalid-information-resource-action';
  const r = getInformationResource(snapshot(state, manifest), parsed.kind, action.resourceId);
  if (!r) return 'information-resource-not-found';
  const controller =
    'control' in parsed && parsed.control.type === 'accept'
      ? r.control?.offer?.target
      : effectiveController(r);
  if (!controller || !sameController(controller, { kind: 'collective', id: collectiveId }))
    return 'collective-does-not-control-resource';
  if (r.revision !== parsed.expectedRevision) return 'revision-conflict';
  if (controlVersion(r) !== parsed.expectedControlVersion) return 'control-version-conflict';
  return undefined;
}
export function executeApprovedInformationResource(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  collectiveId: string,
  decisionId: string,
  action: CollectiveResourceAction,
): ToolExecution {
  const error = validateInformationResourceAction(state, manifest, collectiveId, action);
  if (error) throw new ToolRefusal(error);
  const parsed = parseAction(action.capability, action.arguments)!;
  return executeAction(state, manifest, actorId, action.resourceId, parsed, (c) =>
    sameController(c, { kind: 'collective', id: collectiveId })
      ? { actorId, decisionId }
      : undefined,
  );
}
export function executeResourceControlTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  if (!state.resourceControlPolicy) throw new ToolRefusal('resource-control-not-enabled');
  if (args.kind === 'enterprise')
    return executeEnterpriseControlTool(state, manifest, actorId, name, args, requestId);
  const resources = snapshot(state, manifest),
    id = stringArg(args, 'id');
  const visible = (r: ReturnType<typeof allInformationResources>[number]['resource']) =>
    controllerVisibleTo(state, effectiveController(r), actorId) ||
    (r.control?.offer !== undefined && controllerVisibleTo(state, r.control.offer.target, actorId));
  if (name === 'resources.list')
    return {
      data: pageItems(
        [
          ...allInformationResources(resources)
            .filter((v) => visible(v.resource))
            .map((v) => informationResourceMetadata(v.kind, v.resource)),
          ...visibleEnterpriseResources(state, actorId),
        ].sort((a, b) => a.kind.localeCompare(b.kind, 'en') || a.id.localeCompare(b.id, 'en')),
        args,
      ),
      effects: {},
    };
  const kind = kindOf(args.kind);
  if (!kind) throw new ToolRefusal('unsupported-resource-kind');
  const r = getInformationResource(resources, kind, id);
  if (!r || !visible(r)) throw new ToolRefusal('information-resource-not-found');
  if (name === 'resources.read') return { data: informationResourceMetadata(kind, r), effects: {} };
  const { id: _id, ...actionArgs } = args;
  void _id;
  const action = parseAction(name, actionArgs);
  if (!action) throw new ToolRefusal('invalid-resource-action');
  return executeAction(state, manifest, actorId, id, action, personalControlAuthorization(actorId));
}

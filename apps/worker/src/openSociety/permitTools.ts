import {
  effectiveController,
  personalControlAuthorization,
  type ControlAuthorizationPort,
  type Controller,
} from '@aivilization/authority';
import {
  isPrincipalPremisesPermit,
  PREMISES_USE_SCOPES,
  type PremisesPermit,
} from '@aivilization/premises';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import {
  residentPremisesRightsEvent,
  worldPremisesUseUntil,
  mayEnterWorldPremises,
  mayOperateWorldPremises,
  mayStoreWorldPremises,
  mayResideWorldPremises,
} from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { parsePermitCommand } from './permitCommands';
import { controllerAvailable, principalVisibleTo } from './resourceControlAccess';
import { ToolRefusal, stringArg, pageItems } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
function readable(s: OpenSocietyState, p: PremisesPermit, actor: string) {
  const current = s.world.premises?.buildings[p.buildingId];
  return (
    p.users.includes(actor) ||
    principalVisibleTo(s, p.issuer, actor) ||
    principalVisibleTo(s, p.grantee, actor) ||
    (current ? principalVisibleTo(s, effectiveController(current), actor) : false)
  );
}
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorize: ControlAuthorizationPort,
  actingFor?: Controller,
): ToolExecution {
  const d = residentPremisesRightsEvent({
    projection: s.world,
    actorId,
    command: parsePermitCommand(name, args),
    requestId: `permit-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
    authorization: {
      authorize,
      controllerAvailable: (c) => controllerAvailable(s, c),
      ...(actingFor ? { actingFor } : {}),
    },
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      committed: true,
      id: stringArg(args, 'id'),
      events: d.events.map((e) => ({ id: e.id, at: e.occurredAt, type: e.type })),
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, actorId) },
  };
}
export function executePermitTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const state = s.world.premisesRights;
  if (!state) throw new ToolRefusal('premises-rights-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'permits.rules')
    return result({
      policy: state.policy,
      principalPolicy: state.principalPolicy ?? null,
      principalOperationsWith: state.principalPolicy
        ? 'town principals operate --request <exact permits.* command>'
        : null,
      scopes: PREMISES_USE_SCOPES,
      boundary:
        'Control, permission and actual presence/work are distinct. Only a current controller can offer; grantee independently accepts fixed terms.',
      shared: 'Permission to apply for real capacity, not guaranteed exclusive capacity.',
      exclusive:
        'Excludes conflicting new use only in the exact scope/time; no forced eviction or disposal of goods.',
      payment:
        'If this offer backs a price order, accept through trades accept; payment and permission consent commit together. Availability counters are visible in permits read.',
      end: 'The grantee can release after ending work; expiry stops new use, preserves elapsed labor and permits retrieval of existing goods.',
      readWith: 'town permits read --id ID',
    });
  if (name === 'permits.list')
    return result(
      pageItems(
        Object.values(state.permits)
          .filter((p) => readable(s, p, actorId))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map(({ id, buildingId, title, status, revision, startAt, endAt }) => ({
            id,
            buildingId,
            title,
            status,
            revision,
            startAt,
            endAt,
          })),
        args,
      ),
    );
  if (name === 'permits.read') {
    const p = state.permits[stringArg(args, 'id')];
    if (!p || !readable(s, p, actorId)) throw new ToolRefusal('permit-not-found');
    return result({
      ...p,
      ...(isPrincipalPremisesPermit(p)
        ? {
            requestBase: {
              resourceKind: 'premises-permit',
              resourceId: p.id,
              resourceRevision: p.revision,
              controlVersion: p.issuerVersion,
            },
            operations: ['permits.accept', 'permits.withdraw', 'permits.release'],
            bodyBoundary:
              'Only named users may personally enter or participate; organizational acceptance does not act for their bodies.',
          }
        : {}),
      ...(state.provisions?.[p.id] ? { provision: state.provisions[p.id] } : {}),
    });
  }
  if (name === 'permits.access') {
    const b = s.world.premises?.buildings[stringArg(args, 'buildingId')];
    if (!b) throw new ToolRefusal('premises-not-found');
    const readers = {
      entry: mayEnterWorldPremises,
      operate: mayOperateWorldPremises,
      store: mayStoreWorldPremises,
      reside: mayResideWorldPremises,
    };
    return result({
      buildingId: b.id,
      at: s.world.clock.now,
      status: b.status,
      permissions: Object.fromEntries(
        PREMISES_USE_SCOPES.map((scope) => {
          const until = worldPremisesUseUntil(s.world, actorId, b.locationId, scope);
          return [
            scope,
            {
              allowed: readers[scope](s.world, actorId, b.locationId),
              newUseUntil: until === Number.MAX_SAFE_INTEGER ? null : until,
            },
          ];
        }),
      ),
      capacityReadWith: `town premises read --id ${b.id}`,
    });
  }
  return execute(s, m, actorId, name, args, requestId, personalControlAuthorization(actorId));
}
function collectiveArgs(s: OpenSocietyState, cid: string, a: CollectiveResourceAction) {
  if (!s.world.premisesRights || Object.hasOwn(a.arguments, 'id'))
    throw new ToolRefusal('invalid-collective-permit-action');
  const args = { ...a.arguments, id: a.resourceId },
    c = parsePermitCommand(a.capability, args);
  let parties: readonly Controller[] = [];
  if (c.type === 'offer') {
    const b = s.world.premises?.buildings[c.terms.buildingId];
    if (b) {
      const principal = effectiveController(b);
      if (principal.kind === 'resident' || principal.kind === 'collective')
        parties = [{ kind: principal.kind, id: principal.id }];
    }
  } else {
    const p = s.world.premisesRights.permits[c.id];
    if (p && !isPrincipalPremisesPermit(p))
      parties = c.type === 'withdraw' ? [p.issuer, p.grantee] : [p.grantee];
  }
  if (!parties.some((p) => p.kind === 'collective' && p.id === cid))
    throw new ToolRefusal('collective-permit-controller-mismatch');
  return args;
}
export function validatePermitResourceAction(
  s: OpenSocietyState,
  cid: string,
  a: CollectiveResourceAction,
) {
  try {
    collectiveArgs(s, cid, a);
    return undefined;
  } catch (e) {
    return e instanceof ToolRefusal ? e.reason : 'invalid-collective-permit-action';
  }
}
export function executeApprovedPermitResource(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  cid: string,
  decisionId: string,
  a: CollectiveResourceAction,
  requestId: string,
) {
  return execute(
    s,
    m,
    actorId,
    a.capability,
    collectiveArgs(s, cid, a),
    requestId,
    (c) => (c.kind === 'collective' && c.id === cid ? { actorId, decisionId } : undefined),
    { kind: 'collective', id: cid },
  );
}

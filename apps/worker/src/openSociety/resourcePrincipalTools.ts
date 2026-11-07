import { premisesPrincipalRequest, premisesOperationPrincipal } from '@aivilization/premises';
import {
  residentPrincipalPremisesOperation,
  decodePrincipalPremisesOperation,
} from '@aivilization/world';
import { premisesAuthorization } from './premisesTools';
import {
  assertPrincipalControlRequest,
  assertPrincipalOperationRequest,
  samePrincipalRequest,
  effectiveController,
  type PrincipalRequest,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import { materialOperationRequest, type MaterialStock } from '@aivilization/materials';
import { enterpriseController } from '@aivilization/enterprise';
import {
  residentPrincipalControlEvent,
  residentMaterialEvent,
  decodePrincipalMaterialOperation,
} from '@aivilization/world';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { materialAuthorization } from './materialTools';
import { principalCollectiveAuthority } from './principalCollectiveAuthority';
import { principalVisibleTo, constructionVisibleTo } from './resourceControlAccess';
import { ToolRefusal, pageItems, stringArg } from './arguments';
import { digest } from './journal';
import { openWorldPolicies } from './manifest';

/** Closed envelope validation precedes the asserted input type at this adapter boundary. */
function parse(name: string, value: unknown): PrincipalRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ToolRefusal('invalid-principal-request');
  try {
    if (name === 'principals.control') {
      const r = value as PrincipalControlRequest;
      assertPrincipalControlRequest(r);
      return r;
    }
    if (name === 'principals.operate') {
      const r = value as PrincipalOperationRequest;
      assertPrincipalOperationRequest(r);
      if (r.operation.capability.startsWith('premises.')) decodePrincipalPremisesOperation(r);
      else decodePrincipalMaterialOperation(r);
      return r;
    }
  } catch (error) {
    throw new ToolRefusal(error instanceof Error ? error.message : 'invalid-principal-request');
  }
  throw new ToolRefusal('unknown-principal-capability');
}
const metadata = (v: MaterialStock) => ({
  kind: 'stock',
  id: v.id,
  title: v.title,
  status: v.status,
  locationId: v.locationId,
  revision: v.revision,
  controlVersion: v.control.version,
  controller: effectiveController(v),
  controlPolicyVersion: v.control.policyVersion,
  ...(v.control.offer ? { offer: v.control.offer } : {}),
});
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  r: PrincipalRequest,
  requestId: string,
  decisionId?: string,
): ToolExecution {
  if (!s.world.materials?.resourcePrincipals && !s.world.premises?.resourcePrincipals)
    throw new ToolRefusal('resource-principals-not-enabled');
  const context = {
    projection: s.world,
    actorId,
    simulationId: m.simulationId,
    requestId: `principal-${digest([actorId, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
    collective: principalCollectiveAuthority(s, decisionId ? { decisionId } : {}),
  };
  if ('operation' in r && r.operation.capability.startsWith('premises.')) {
    const d = residentPrincipalPremisesOperation({
      ...context,
      request: r,
      authorization: premisesAuthorization(s, () => undefined),
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind ${r.resourceKind} --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if (!('operation' in r) && r.resourceKind === 'premises') {
    const d = residentPrincipalControlEvent({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind ${r.resourceKind} --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if (r.resourceKind !== 'stock') throw new ToolRefusal('principal-resource-kind-not-connected');
  const stock = s.world.materials?.resourcePrincipals && s.world.materials.stocks[r.resourceId];
  if (!stock) throw new ToolRefusal('material-stock-unavailable');
  const d = (() => {
    if (!('operation' in r)) return residentPrincipalControlEvent({ ...context, request: r });
    if (stock.control.policyVersion !== 'resource-principals-v2')
      throw new ToolRefusal('principal-resource-not-transitioned');
    const command = decodePrincipalMaterialOperation(r);
    if (!samePrincipalRequest(materialOperationRequest(stock, command), r))
      throw new ToolRefusal('principal-operation-version-or-resource-conflict');
    return residentMaterialEvent({
      ...context,
      command,
      authorization: materialAuthorization(s, () => undefined),
      policies: openWorldPolicies(m.seed, s.world, m.rhythm, m.canonicalPolicyContinuation),
    });
  })();
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      kind: r.resourceKind,
      id: r.resourceId,
      events: d.events.map((e) => ({ id: e.id, type: e.type })),
      readWith: 'town principals read --kind stock --id ' + r.resourceId,
    },
    effects: { worldEvents: d.events },
  };
}
export function executeResourcePrincipalTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): ToolExecution {
  const state = s.world.materials;
  if (!state?.resourcePrincipals && !s.world.premises?.resourcePrincipals)
    throw new ToolRefusal('resource-principals-not-enabled');
  const visible = (v: MaterialStock) =>
    principalVisibleTo(s, effectiveController(v), actorId) ||
    (!!v.control.offer &&
      v.control.offer.expiresAt > s.world.clock.now &&
      principalVisibleTo(s, v.control.offer.target, actorId)) ||
    v.readers.includes(actorId);
  if (name === 'principals.list') {
    const premises = s.world.premises;
    const buildings = premises?.resourcePrincipals
      ? Object.values(premises.buildings)
          .filter(
            (b) =>
              b.control.policyVersion === 'resource-principals-v2' &&
              (principalVisibleTo(s, b.control.controller, actorId) ||
                (!!b.control.offer &&
                  b.control.offer.expiresAt > s.world.clock.now &&
                  principalVisibleTo(s, b.control.offer.target, actorId))),
          )
          .map((b) => ({
            kind: 'premises',
            id: b.id,
            title: b.title,
            status: b.status,
            locationId: b.locationId,
            controller: b.control.controller,
            revision: b.revision,
            controlVersion: b.control.version,
          }))
      : [];
    const projects = premises?.resourcePrincipals
      ? Object.values(premises.projects)
          .filter((p) => p.principalAuthorization && constructionVisibleTo(s, p, actorId))
          .map((p) => ({
            kind: 'construction-project',
            id: p.id,
            title: p.title,
            status: p.status,
            siteId: p.siteId,
            controller: p.controller,
            revision: p.revision,
            controlVersion: 1,
          }))
      : [];
    return {
      data: {
        ...pageItems(
          [
            ...Object.values(state?.resourcePrincipals ? state.stocks : {})
              .filter(visible)
              .map(metadata),
            ...buildings,
            ...projects,
          ].sort((a, b) => a.kind.localeCompare(b.kind, 'en') || a.id.localeCompare(b.id, 'en')),
          args,
        ),
        premisesPolicyVersion: premises?.resourcePrincipals?.version ?? null,
        sitesWith: premises?.resourcePrincipals ? 'town sites list' : null,
      },
      effects: {},
    };
  }
  if (name === 'principals.read' && args.kind !== 'stock') {
    const p = s.world.premises,
      id = stringArg(args, 'id');
    if (!p?.resourcePrincipals) throw new ToolRefusal('premises-principals-not-enabled');
    if (args.kind === 'construction-site') {
      const site = p.sites[id];
      if (!site) throw new ToolRefusal('construction-site-not-found');
      return {
        data: {
          kind: args.kind,
          ...site,
          landUsePolicy: p.landUsePolicy,
          requestBase: {
            resourceKind: args.kind,
            resourceId: id,
            resourceRevision: site.revision,
            controlVersion: p.landUsePolicy.revision,
          },
          operation: 'premises.create-construction',
          queryBlueprintWith: 'town sites estimate',
          queryMaterialsWith: 'town materials list',
          limitation:
            'A source reservation does not accept a project or authorize labor. Exact independent principal authorization is required.',
        },
        effects: {},
      };
    }
    if (args.kind === 'construction-project') {
      const project = p.projects[id];
      if (!project || !constructionVisibleTo(s, project, actorId))
        throw new ToolRefusal('principal-project-not-readable');
      return {
        data: {
          kind: args.kind,
          project,
          requestBase: {
            resourceKind: args.kind,
            resourceId: id,
            resourceRevision: project.revision,
            controlVersion: 1,
          },
          operation: 'premises.cancel-construction',
          personalWorkWith: `town construction read --id ${id}`,
        },
        effects: {},
      };
    }
    if (args.kind === 'premises') {
      const b = p.buildings[id];
      if (
        !b ||
        !(
          principalVisibleTo(s, b.control.controller, actorId) ||
          (!!b.control.offer &&
            b.control.offer.expiresAt > s.world.clock.now &&
            principalVisibleTo(s, b.control.offer.target, actorId))
        )
      )
        throw new ToolRefusal('principal-premises-not-readable');
      return {
        data: {
          kind: args.kind,
          id: b.id,
          title: b.title,
          status: b.status,
          locationId: b.locationId,
          controller: b.control.controller,
          ...(b.control.offer ? { offer: b.control.offer } : {}),
          controlPolicyVersion: b.control.policyVersion,
          controlWith: 'town principals control --request <requestBase + command>',
          access: b.access,
          condition: b.condition,
          blueprint: b.blueprint,
          embodied: b.embodied,
          salvage: b.salvage,
          requestBase: {
            resourceKind: args.kind,
            resourceId: id,
            resourceRevision: b.revision,
            controlVersion: b.control.version,
          },
          operations: ['premises.create-construction', 'premises.manage-premises'],
          limitations:
            'Usage is distinct from administration: who may enter, operate or live in a building is set with premises.manage-premises.',
        },
        effects: {},
      };
    }
    throw new ToolRefusal('principal-resource-kind-not-connected');
  }
  if (name === 'principals.read') {
    if (args.kind !== 'stock') throw new ToolRefusal('principal-resource-kind-not-connected');
    const v = state?.resourcePrincipals && state.stocks[stringArg(args, 'id')];
    if (!v || !visible(v)) throw new ToolRefusal('principal-resource-not-found');
    return {
      data: {
        ...metadata(v),
        inventory: v.inventory,
        permissions: { contributors: v.contributors, readers: v.readers },
        requestBase: {
          resourceKind: 'stock',
          resourceId: v.id,
          resourceRevision: v.revision,
          controlVersion: v.control.version,
        },
        commands: {
          control:
            'town principals control --request <JSON: requestBase + command offer/accept/cancel>',
          operate:
            'town principals operate --request <JSON: requestBase + operation {capability:materials.<domain-command>,arguments:full-domain-command}>',
          collective:
            'town collectives propose: resource action principals.control/operate with arguments {request}; independently vote, decide and execute',
          public:
            'town governance propose: action {kind:control-resource|manage-resource,expectedRevision:resourceRevision,request}; independently vote, close and execute',
        },
        limitations:
          'Stock custody only. Operations supported: withdraw, configure-stock, settle-stock, close-stock, create-production, create-extraction, cancel-production, reserve-materials, reservation-withdrawn. Body participation stays personal. Enterprise administration uses current management, collective/public need exact independent approval; capital and authorship do not grant control. Existing permits, reservations and obligations persist.',
      },
      effects: {},
    };
  }
  return execute(s, m, actorId, parse(name, args.request), requestId);
}
export function validatePrincipalResourceAction(
  s: OpenSocietyState,
  collectiveId: string,
  action: CollectiveResourceAction,
): string | undefined {
  try {
    if (Object.keys(action.arguments).length !== 1 || !Object.hasOwn(action.arguments, 'request'))
      return 'invalid-principal-resource-action';
    const parsed = parse(action.capability, action.arguments.request);
    if ('operation' in parsed && parsed.operation.capability.startsWith('premises.')) {
      const p = s.world.premises;
      if (!p?.resourcePrincipals) return 'premises-principals-not-enabled';
      const c = decodePrincipalPremisesOperation(parsed),
        expected = premisesPrincipalRequest(p, c),
        subject = premisesOperationPrincipal(p, c);
      if (action.resourceId !== parsed.resourceId || !samePrincipalRequest(expected, parsed))
        return 'principal-resource-version-conflict';
      if (subject.kind === 'collective' && subject.id === collectiveId) return;
      const e = subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined,
        manager = e && enterpriseController(e);
      return manager && manager.kind === 'collective' && manager.id === collectiveId
        ? undefined
        : 'collective-principal-authority-required';
    }
    const r = parse(action.capability, action.arguments.request),
      resource =
        r.resourceKind === 'stock'
          ? s.world.materials?.stocks[r.resourceId]
          : r.resourceKind === 'premises' && s.world.premises?.resourcePrincipals
            ? s.world.premises.buildings[r.resourceId]
            : undefined;
    if (
      !(r.resourceKind === 'premises'
        ? s.world.premises?.resourcePrincipals
        : s.world.materials?.resourcePrincipals)
    )
      return 'resource-principals-not-enabled';
    if (action.resourceId !== r.resourceId || !resource) return 'principal-resource-not-found';
    if (resource.revision !== r.resourceRevision || resource.control.version !== r.controlVersion)
      return 'principal-resource-version-conflict';
    const p =
      'command' in r && r.command.type === 'accept'
        ? resource.control.offer?.target
        : effectiveController(resource);
    if (p?.kind === 'collective' && p.id === collectiveId) return;
    const e = p?.kind === 'enterprise' && s.world.enterprises[p.id],
      manager = e && enterpriseController(e);
    if (manager && manager.kind === 'collective' && manager.id === collectiveId) return;
    return 'collective-principal-authority-required';
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid-principal-resource-action';
  }
}
export function executeApprovedPrincipalResource(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  collectiveId: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
): ToolExecution {
  const failure = validatePrincipalResourceAction(s, collectiveId, action);
  if (failure) throw new ToolRefusal(failure);
  return execute(
    s,
    m,
    actorId,
    parse(action.capability, action.arguments.request),
    requestId,
    decisionId,
  );
}

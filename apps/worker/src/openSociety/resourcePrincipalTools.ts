import { worldExperiences } from './worldTools';
import { residentLaborTermsEvent, parseEnterpriseLaborCommand } from '@aivilization/world';
import {
  constructionOrderMetadata,
  assertConstructionOfferReadable,
  readConstructionOrder,
  constructionTradeCollectiveFailure,
} from './constructionTradeTools';
import {
  decodeConstructionTradeOperation,
  residentConstructionTradeRequestOperation,
} from '@aivilization/world';
import { readResourceSale, resourceSaleEntry } from './resourceSaleTools';
import { executePeriodicTool } from './periodicTools';
import { periodicSubjects, readPeriodicAccounts } from '@aivilization/commerce';
import {
  residentPeriodicOperation,
  decodePeriodicOperation,
  worldPeriodicRequest,
  periodicObligationPorts,
} from '@aivilization/world';
import { resourceSaleRequest, resourceSaleSubject } from '@aivilization/commerce';
import {
  decodeResourceSaleOperation,
  residentResourceSaleOperation,
  worldResourceSaleSource,
} from '@aivilization/world';
import {
  currentServiceEnterprise,
  decodeServiceSupplyRelationOperation,
  serviceSupplyRelationRequest,
  serviceSupplyRelationSubject,
} from '@aivilization/services';
import { residentServiceSupplyRelationOperation } from '@aivilization/world';
import {
  decodeServiceAffiliationOperation,
  serviceAffiliationConsentFor,
  serviceAffiliationRequest,
} from '@aivilization/services';
import { residentServiceAffiliationOperation } from '@aivilization/world';
import { decodeServicePrincipalOperation } from '@aivilization/services';
import {
  decodeServiceCreation,
  decodeServiceReopening,
  serviceCreationRequest,
  SERVICE_DIRECTORY_ID,
} from '@aivilization/services';
import { residentServiceSupplyOperation } from '@aivilization/world';
import { residentServicePrincipalOperation } from '@aivilization/world';
import {
  decodeVehiclePrincipalOperation,
  vehiclePrincipalRequest,
  authorizedDriver,
} from '@aivilization/mobility';
import { residentVehiclePrincipalOperation } from '@aivilization/world';
import { resourcePrincipalSnapshot } from '@aivilization/authority';
import { principalTradeRequest, principalTradeSubject } from '@aivilization/commerce';
import {
  decodePrincipalTradeOperation,
  residentPrincipalTradeOperation,
  principalPermitTradeEvidence,
} from '@aivilization/world';
import { principalPermitRequest, principalPermitSubject } from '@aivilization/premises';
import {
  residentPrincipalPermitOperation,
  decodePrincipalPermitOperation,
} from '@aivilization/world';
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
      if (r.operation.capability === 'services.create') decodeServiceCreation(r);
      else if (r.operation.capability === 'services.reopen') decodeServiceReopening(r);
      else if (
        ['services.approve-control', 'services.revoke-control'].includes(r.operation.capability)
      )
        decodeServiceAffiliationOperation(r);
      else if (
        [
          'services.offer-supply',
          'services.accept-supply',
          'services.end-supply',
          'services.cancel-supply',
        ].includes(r.operation.capability)
      )
        decodeServiceSupplyRelationOperation(r);
      else if (r.resourceKind === 'service') decodeServicePrincipalOperation(r);
      else if (r.operation.capability.startsWith('vehicles.')) decodeVehiclePrincipalOperation(r);
      else if (r.operation.capability.startsWith('resource-sales.')) decodeResourceSaleOperation(r);
      else if (r.resourceKind === 'periodic-obligation') decodePeriodicOperation(r);
      else if (r.operation.capability.startsWith('construction-trades.'))
        decodeConstructionTradeOperation(r);
      else if (r.operation.capability.startsWith('trades.')) decodePrincipalTradeOperation(r);
      else if (r.operation.capability.startsWith('permits.')) decodePrincipalPermitOperation(r);
      else if (r.operation.capability.startsWith('premises.')) decodePrincipalPremisesOperation(r);
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
  if (
    !s.world.materials?.resourcePrincipals &&
    !s.world.premises?.resourcePrincipals &&
    !s.world.residentMobility?.principalPolicy &&
    !s.services?.principalPolicy &&
    !s.world.periodicObligations &&
    s.world.residentLabor?.configuration.compensationSource !== 'accepted-enterprise-labor-terms-v1'
  )
    throw new ToolRefusal('resource-principals-not-enabled');
  const context = {
    projection: s.world,
    actorId,
    simulationId: m.simulationId,
    requestId: `principal-${digest([actorId, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
    collective: principalCollectiveAuthority(s, decisionId ? { decisionId } : {}),
  };
  if (
    'operation' in r &&
    r.resourceKind === 'enterprise-labor-terms' &&
    r.operation.capability === 'business.change-labor-terms'
  ) {
    const command = parseEnterpriseLaborCommand(r.operation.arguments.command);
    if (!['offer', 'withdraw'].includes(command.type))
      throw new ToolRefusal('labor-terms-personal-consent-required');
    const d = residentLaborTermsEvent({
      ...context,
      enterpriseId: r.resourceId,
      command,
      expectedRequest: r,
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: { enterpriseId: r.resourceId, id: command.id },
      effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events) },
    };
  }
  if ('operation' in r && ['services.create', 'services.reopen'].includes(r.operation.capability)) {
    if (!s.services?.registration) throw new ToolRefusal('service-supply-not-enabled');
    const d = residentServiceSupplyOperation({ ...context, directory: s.services, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith:
          r.operation.capability === 'services.create'
            ? 'town services list'
            : `town principals read --kind service --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if (
    r.resourceKind === 'service' &&
    s.services?.relationPolicy &&
    (!('operation' in r) ||
      [
        'services.offer-supply',
        'services.accept-supply',
        'services.end-supply',
        'services.cancel-supply',
      ].includes(r.operation.capability))
  ) {
    const d = residentServiceSupplyRelationOperation({
      ...context,
      directory: s.services,
      request: r,
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: 'service',
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind service --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if (
    r.resourceKind === 'service' &&
    s.services &&
    (('operation' in r &&
      ['services.approve-control', 'services.revoke-control'].includes(r.operation.capability)) ||
      (!('operation' in r) && serviceAffiliationConsentFor(s.services, r, s.world.clock.now)))
  ) {
    const d = residentServiceAffiliationOperation({
      ...context,
      directory: s.services,
      request: r,
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: 'service',
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind service --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if (r.resourceKind === 'service') {
    if (!s.services?.principalPolicy) throw new ToolRefusal('service-principals-not-enabled');
    const d = residentServicePrincipalOperation({ ...context, directory: s.services, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind service --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if ('operation' in r && r.operation.capability.startsWith('vehicles.')) {
    const d = residentVehiclePrincipalOperation({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind vehicle --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if ('operation' in r && r.resourceKind === 'periodic-obligation') {
    const d = residentPeriodicOperation({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town obligations read --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if ('operation' in r && r.resourceKind === 'resource-sale') {
    const d = residentResourceSaleOperation({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind resource-sale --id ${r.resourceId}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if ('operation' in r && r.operation.capability.startsWith('construction-trades.')) {
    const command = decodeConstructionTradeOperation(r);
    assertConstructionOfferReadable(s, actorId, command);
    const d = residentConstructionTradeRequestOperation({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    const id = command.type === 'offer' ? command.terms.id : command.id;
    return {
      data: {
        kind: 'construction-order',
        id,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: `town principals read --kind construction-order --id ${id}`,
      },
      effects: { worldEvents: d.events },
    };
  }
  if ('operation' in r && r.operation.capability.startsWith('trades.')) {
    const command = decodePrincipalTradeOperation(r),
      d = residentPrincipalTradeOperation({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: command.id,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: 'town trades read --id ' + command.id,
      },
      effects: { worldEvents: d.events },
    };
  }
  if ('operation' in r && r.operation.capability.startsWith('permits.')) {
    const command = decodePrincipalPermitOperation(r),
      permitId = command.type === 'offer' ? command.terms.id : command.id;
    const d = residentPrincipalPermitOperation({ ...context, request: r });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: {
        kind: r.resourceKind,
        id: r.resourceId,
        events: d.events.map((e) => ({ id: e.id, type: e.type })),
        readWith: 'town permits read --id ' + permitId,
      },
      effects: { worldEvents: d.events },
    };
  }
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
  if (!('operation' in r) && (r.resourceKind === 'premises' || r.resourceKind === 'vehicle')) {
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
  if (
    !state?.resourcePrincipals &&
    !s.world.premises?.resourcePrincipals &&
    !s.world.residentMobility?.principalPolicy &&
    !s.services?.principalPolicy &&
    !s.world.periodicObligations
  )
    throw new ToolRefusal('resource-principals-not-enabled');
  const visible = (v: MaterialStock) =>
    principalVisibleTo(s, effectiveController(v), actorId) ||
    (!!v.control.offer &&
      v.control.offer.expiresAt > s.world.clock.now &&
      principalVisibleTo(s, v.control.offer.target, actorId)) ||
    v.readers.includes(actorId);
  const serviceVisible = (v: NonNullable<typeof s.services>['services'][string]) => {
    const c = resourcePrincipalSnapshot(v);
    return (
      principalVisibleTo(s, c.controller, actorId) ||
      (!!c.offer &&
        c.offer.expiresAt > s.world.clock.now &&
        principalVisibleTo(s, c.offer.target, actorId)) ||
      (!!v.supplyRelation?.offer &&
        principalVisibleTo(
          s,
          { kind: 'enterprise', id: v.supplyRelation.offer.enterpriseId },
          actorId,
        )) ||
      !!v.namedProviders?.includes(actorId) ||
      (!!s.services?.affiliations &&
        !!currentServiceEnterprise(v) &&
        principalVisibleTo(s, { kind: 'enterprise', id: currentServiceEnterprise(v)! }, actorId))
    );
  };
  const serviceMetadata = (v: NonNullable<typeof s.services>['services'][string]) => {
    const c = resourcePrincipalSnapshot(v);
    return {
      kind: 'service',
      id: v.id,
      title: v.title,
      active: v.active,
      locationId: v.locationId,
      revision: v.revision,
      controlVersion: c.version,
      controller: c.controller,
    };
  };
  if (name === 'principals.read' && args.kind === 'resource-sale')
    return readResourceSale(s, actorId, args);
  if (name === 'principals.read' && args.kind === 'periodic-obligation')
    return executePeriodicTool(s, m, actorId, 'obligations.read', args);
  if (name === 'principals.read' && args.kind === 'service-directory') {
    if (!s.services?.registration || args.id !== SERVICE_DIRECTORY_ID)
      throw new ToolRefusal('service-directory-not-readable');
    return {
      data: {
        kind: 'service-directory',
        id: SERVICE_DIRECTORY_ID,
        policyVersion: s.services.registration.policy.version,
        revision: s.services.registration.revision,
        requestBase: {
          resourceKind: 'service-directory',
          resourceId: SERVICE_DIRECTORY_ID,
          resourceRevision: s.services.registration.revision,
          controlVersion: 1,
        },
        operations: ['services.create'],
        input: {
          principal: 'exact actual resident/collective/enterprise/public subject',
          command: 'publish fields; enterpriseId is forbidden',
          enterpriseSupply:
            'optional true for controller-enterprise affiliation; otherwise management and employer remain separate',
        },
        limits:
          'Directory creation does not create facilities, named providers, body consent, wages or fees. All creations advance this registration version.',
      },
      effects: {},
    };
  }
  if (name === 'principals.read' && args.kind === 'service') {
    if (!s.services?.principalPolicy) throw new ToolRefusal('service-principals-not-enabled');
    const v = s.services.services[stringArg(args, 'id')];
    if (!v || !serviceVisible(v)) throw new ToolRefusal('principal-service-not-readable');
    const c = resourcePrincipalSnapshot(v);
    return {
      data: {
        ...serviceMetadata(v),
        authoredBy: v.ownerId,
        ...(c.offer ? { offer: c.offer } : {}),
        namedProviders: v.namedProviders ?? null,
        originalEnterpriseAffiliation: v.enterpriseId ?? null,
        enterpriseAffiliation: currentServiceEnterprise(v) ?? null,
        ...(s.services.relationPolicy
          ? {
              supplyRelation: v.supplyRelation ?? {
                policyVersion: s.services.relationPolicy.version,
                version: 1,
                enterpriseId: currentServiceEnterprise(v) ?? null,
              },
              supplyOperations: [
                'services.offer-supply',
                'services.accept-supply',
                'services.end-supply',
                'services.cancel-supply',
              ],
            }
          : {}),
        ...(s.services.affiliations && currentServiceEnterprise(v)
          ? {
              affiliationConsent: s.services.affiliations.consents[v.id] ?? null,
              affiliationRegistryRevision: s.services.affiliations.revision,
              affiliationOperations: ['services.approve-control', 'services.revoke-control'],
              affiliationTemplate: {
                type: 'services.approve-control',
                request: 'Complete exact PrincipalControlRequest from this requestBase',
                expiresAt: 'Simulation time deadline',
                registryRevision: s.services.affiliations.revision,
              },
            }
          : {}),
        requestBase: {
          resourceKind: 'service',
          resourceId: v.id,
          resourceRevision: v.revision,
          controlVersion: c.version,
        },
        operations: [
          ...(s.services.registration ? ['services.reopen'] : []),
          'services.schedule',
          'services.close',
          'bookings.accept',
          'bookings.cancel',
          'queues.call',
          'services.authorize-provider',
          'services.revoke-provider',
        ],
        personalSupplyWith: 'town services start/stop',
        slotsWith: `town services read --id ${v.id}`,
        limitations:
          'Directory management does not transfer attendance, wage contracts, payments or clinical records. Enterprise affiliation requires a separate exact source. Actual active provider permission cannot be revoked; body participation is personal.',
      },
      effects: {},
    };
  }
  const mobility = s.world.residentMobility;
  const vehicleVisible = (v: NonNullable<typeof mobility>['vehicles'][string]) => {
    const control = resourcePrincipalSnapshot(v);
    return (
      principalVisibleTo(s, control.controller, actorId) ||
      authorizedDriver(v, actorId) ||
      (!!control.offer &&
        control.offer.expiresAt > s.world.clock.now &&
        principalVisibleTo(s, control.offer.target, actorId))
    );
  };
  const vehicleMetadata = (v: NonNullable<typeof mobility>['vehicles'][string]) => {
    const control = resourcePrincipalSnapshot(v);
    return {
      kind: 'vehicle',
      id: v.id,
      locationId: v.locationId,
      revision: v.revision,
      controlVersion: control.version,
      controller: control.controller,
    };
  };
  if (name === 'principals.read' && args.kind === 'vehicle') {
    if (!mobility?.principalPolicy) throw new ToolRefusal('vehicle-principals-not-enabled');
    const v = mobility.vehicles[stringArg(args, 'id')];
    if (!v || !vehicleVisible(v)) throw new ToolRefusal('principal-vehicle-not-readable');
    const control = resourcePrincipalSnapshot(v);
    return {
      data: {
        ...vehicleMetadata(v),
        controlPolicyVersion: v.control?.policyVersion ?? 'legacy-owner-v1',
        ...(control.offer ? { offer: control.offer } : {}),
        namedDrivers: v.control ? v.authorized : [...new Set([...v.authorized, v.ownerId])],
        ...resourceSaleEntry(s, v.id, 'vehicle', actorId),
        seats: v.seats,
        cargoCapacity: v.cargoCapacity ?? null,
        journey: v.journey ?? null,
        requestBase: {
          resourceKind: 'vehicle',
          resourceId: v.id,
          resourceRevision: v.revision,
          controlVersion: control.version,
        },
        operations: ['vehicles.authorize', 'vehicles.revoke'],
        controlWith: 'town principals control --request <requestBase + command>',
        driveWith: `town vehicles drive --id ${v.id} --expected-revision ${v.revision} --destination <location>`,
        limitations:
          'Control does not grant driving permission, compel personal labor, transfer current cargo or assign existing driver fare income. Bookings and journeys block control/permission changes; actual freight custody blocks driver permission revocation.',
      },
      effects: {},
    };
  }
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
            ...(s.services?.registration
              ? [
                  {
                    kind: 'service-directory',
                    id: SERVICE_DIRECTORY_ID,
                    title: 'Actual service registration',
                    revision: s.services.registration.revision,
                    controlVersion: 1,
                  },
                ]
              : []),
            ...Object.values(state?.resourcePrincipals ? state.stocks : {})
              .filter(visible)
              .map(metadata),
            ...Object.values(s.services?.principalPolicy ? s.services.services : {})
              .filter(serviceVisible)
              .map(serviceMetadata),
            ...Object.values(mobility?.principalPolicy ? mobility.vehicles : {})
              .filter(vehicleVisible)
              .map(vehicleMetadata),
            ...buildings,
            ...projects,
            ...constructionOrderMetadata(s, actorId),
          ].sort((a, b) => a.kind.localeCompare(b.kind, 'en') || a.id.localeCompare(b.id, 'en')),
          args,
        ),
        servicePolicyVersion: s.services?.principalPolicy?.version ?? null,
        serviceSupplyPolicyVersion: s.services?.registration?.policy.version ?? null,
        serviceAffiliationPolicyVersion: s.services?.affiliations?.policy.version ?? null,
        serviceSupplyRelationPolicyVersion: s.services?.relationPolicy?.version ?? null,
        vehiclePolicyVersion: mobility?.principalPolicy?.version ?? null,
        premisesPolicyVersion: premises?.resourcePrincipals?.version ?? null,
        principalPermitsPolicyVersion: s.world.premisesRights?.principalPolicy?.version ?? null,
        resourceSalesPolicyVersion: s.world.resourceSales?.policy.version ?? null,
        resourceAdapters: s.world.resourceAdapters ?? null,
        periodicAccess: s.world.periodicAccess ?? null,
        serviceClosurePolicy: s.world.serviceClosurePolicy ?? null,
        constructionTradePolicyVersion:
          s.world.residentTrade?.constructionOrders?.policy.version ?? null,
        principalTradePolicyVersion: s.world.residentTrade?.principalOrders?.policy.version ?? null,
        tradesWith: s.world.residentTrade?.principalOrders ? 'town trades list' : null,
        permitsWith: s.world.premisesRights?.principalPolicy ? 'town permits list' : null,
        sitesWith: premises?.resourcePrincipals ? 'town sites list' : null,
      },
      effects: {},
    };
  }
  if (name === 'principals.read' && args.kind === 'construction-order')
    return readConstructionOrder(s, actorId, stringArg(args, 'id'));
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
          ...(s.world.residentTrade?.constructionOrders
            ? {
                constructionTrade: {
                  offerWith: 'town principals operate --request JSON',
                  capability: 'construction-trades.offer',
                  arguments: {
                    type: 'offer',
                    terms: { projectId: id, sourceRevision: project.revision },
                  },
                  requiredTerms: [
                    'id',
                    'seller',
                    'buyer',
                    'payer',
                    'revenue',
                    'amount',
                    'acceptBy',
                    'title',
                    'terms',
                  ],
                  limitation:
                    'Supply exact original parties and accounts. The buyer must be this project beneficiary; an offer does not authorize work or reserve buyer money.',
                },
              }
            : {}),
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
          ...resourceSaleEntry(s, id, 'premises', actorId),
          salvage: b.salvage,
          requestBase: {
            resourceKind: args.kind,
            resourceId: id,
            resourceRevision: b.revision,
            controlVersion: b.control.version,
          },
          operations: [
            'premises.create-construction',
            'premises.manage-premises',
            ...(s.world.premisesRights?.principalPolicy ? ['permits.offer'] : []),
          ],
          limitations:
            'Usage is distinct from administration. Explicit principal-permits allow exact named use contracts through permits.* operations; old v1 issuance cannot replace organizational authority. Principal fee accounts require explicit principal-trade-v3, exact subject accounts and independently authorized atomic payment/consent.',
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
        ...resourceSaleEntry(s, v.id, 'stock', actorId),
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
    if ('operation' in parsed && parsed.resourceKind === 'periodic-obligation') {
      const state = s.world.periodicObligations;
      if (!state) return 'periodic-obligations-not-enabled';
      const c = decodePeriodicOperation(parsed);
      if (
        action.resourceId !== parsed.resourceId ||
        !samePrincipalRequest(worldPeriodicRequest(s.world, c), parsed)
      )
        return 'principal-resource-version-conflict';
      const subjects = periodicSubjects(
        state,
        c,
        c.type === 'offer'
          ? readPeriodicAccounts(periodicObligationPorts(s.world, 'system'), c)
          : undefined,
      );
      return subjects.some((subject) => {
        if (subject.kind === 'collective') return subject.id === collectiveId;
        const enterprise =
          subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined;
        const manager = enterprise && enterpriseController(enterprise);
        return manager?.kind === 'collective' && manager.id === collectiveId;
      })
        ? undefined
        : 'collective-principal-authority-required';
    }
    if ('operation' in parsed && parsed.resourceKind === 'resource-sale') {
      const state = s.world.resourceSales;
      if (!state) return 'resource-sales-not-enabled';
      const c = decodeResourceSaleOperation(parsed),
        source = worldResourceSaleSource(
          s.world,
          c.type === 'offer' ? c.resource.id : (state.sales[c.id]?.source.id ?? ''),
          c.type === 'offer' ? c.resource.kind : (state.sales[c.id]?.source.kind ?? 'premises'),
        );
      if (
        action.resourceId !== parsed.resourceId ||
        !samePrincipalRequest(resourceSaleRequest(state, c, source), parsed)
      )
        return 'principal-resource-version-conflict';
      const subject = resourceSaleSubject(state, c, source);
      if (subject.kind === 'collective' && subject.id === collectiveId) return;
      const e = subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined,
        manager = e && enterpriseController(e);
      return manager?.kind === 'collective' && manager.id === collectiveId
        ? undefined
        : 'collective-principal-authority-required';
    }
    if ('operation' in parsed && parsed.operation.capability.startsWith('construction-trades.')) {
      if (action.resourceId !== parsed.resourceId) return 'principal-resource-version-conflict';
      return constructionTradeCollectiveFailure(s, collectiveId, parsed);
    }
    if ('operation' in parsed && parsed.operation.capability.startsWith('trades.')) {
      const trade = s.world.residentTrade;
      if (!trade?.principalOrders) return 'principal-trade-not-enabled';
      const c = decodePrincipalTradeOperation(parsed),
        evidence = principalPermitTradeEvidence(
          s.world,
          c.type === 'offer' ? c.source.id : (trade.principalOrders.orders[c.id]?.source.id ?? ''),
        );
      if (
        action.resourceId !== parsed.resourceId ||
        !samePrincipalRequest(principalTradeRequest(trade, c, evidence), parsed)
      )
        return 'principal-resource-version-conflict';
      const subject = principalTradeSubject(trade, c, evidence);
      if (subject.kind === 'collective' && subject.id === collectiveId) return;
      const e = subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined,
        manager = e && enterpriseController(e);
      return manager && manager.kind === 'collective' && manager.id === collectiveId
        ? undefined
        : 'collective-principal-authority-required';
    }
    if ('operation' in parsed && parsed.operation.capability.startsWith('permits.')) {
      const rights = s.world.premisesRights;
      if (!rights?.principalPolicy) return 'principal-permits-not-enabled';
      const command = decodePrincipalPermitOperation(parsed),
        ports = { building: (id: string) => s.world.premises?.buildings[id] };
      if (
        action.resourceId !== parsed.resourceId ||
        !samePrincipalRequest(principalPermitRequest(rights, command, ports), parsed)
      )
        return 'principal-resource-version-conflict';
      const subject = principalPermitSubject(rights, command, ports);
      if (subject.kind === 'collective' && subject.id === collectiveId) return;
      const e = subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined,
        manager = e && enterpriseController(e);
      return manager && manager.kind === 'collective' && manager.id === collectiveId
        ? undefined
        : 'collective-principal-authority-required';
    }
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
    if ('operation' in parsed && parsed.resourceKind === 'service-directory') {
      if (!s.services?.registration) return 'service-supply-not-enabled';
      const c = decodeServiceCreation(parsed),
        expected = serviceCreationRequest(s.services, c);
      if (action.resourceId !== parsed.resourceId || !samePrincipalRequest(expected, parsed))
        return 'principal-resource-version-conflict';
      if (c.principal.kind === 'collective' && c.principal.id === collectiveId) return;
      const e = c.principal.kind === 'enterprise' && s.world.enterprises[c.principal.id],
        manager = e && enterpriseController(e);
      return manager && manager.kind === 'collective' && manager.id === collectiveId
        ? undefined
        : 'collective-principal-authority-required';
    }
    if (parsed.resourceKind === 'service') {
      const v = s.services?.principalPolicy && s.services.services[parsed.resourceId];
      if (!v || action.resourceId !== parsed.resourceId) return 'principal-resource-not-found';
      const c = resourcePrincipalSnapshot(v);
      if (v.revision !== parsed.resourceRevision || c.version !== parsed.controlVersion)
        return 'principal-resource-version-conflict';
      if (
        'operation' in parsed &&
        ['services.approve-control', 'services.revoke-control'].includes(
          parsed.operation.capability,
        )
      ) {
        if (!s.services?.affiliations || !currentServiceEnterprise(v))
          return 'service-affiliation-source-required';
        const cmd = decodeServiceAffiliationOperation(parsed);
        if (
          cmd.registryRevision !== s.services.affiliations.revision ||
          !samePrincipalRequest(parsed, serviceAffiliationRequest(s.services, v.id, cmd))
        )
          return 'principal-resource-version-conflict';
        const e = s.world.enterprises[currentServiceEnterprise(v)!],
          manager = e && enterpriseController(e);
        return manager?.kind === 'collective' && manager.id === collectiveId
          ? undefined
          : 'collective-principal-authority-required';
      }
      if (
        'operation' in parsed &&
        [
          'services.offer-supply',
          'services.accept-supply',
          'services.end-supply',
          'services.cancel-supply',
        ].includes(parsed.operation.capability)
      ) {
        if (!s.services?.relationPolicy) return 'service-supply-relations-not-enabled';
        const command = decodeServiceSupplyRelationOperation(parsed),
          expected = serviceSupplyRelationRequest(v, command),
          subject = serviceSupplyRelationSubject(v, command);
        if (!samePrincipalRequest(parsed, expected)) return 'principal-resource-version-conflict';
        if (subject.kind === 'collective' && subject.id === collectiveId) return;
        const e = subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined,
          manager = e && enterpriseController(e);
        return manager?.kind === 'collective' && manager.id === collectiveId
          ? undefined
          : 'collective-principal-authority-required';
      }
      const subject =
        'command' in parsed && parsed.command.type === 'accept' ? c.offer?.target : c.controller;
      if (subject?.kind === 'collective' && subject.id === collectiveId) return;
      const e = subject?.kind === 'enterprise' && s.world.enterprises[subject.id],
        manager = e && enterpriseController(e);
      return manager && manager.kind === 'collective' && manager.id === collectiveId
        ? undefined
        : 'collective-principal-authority-required';
    }
    if (parsed.resourceKind === 'vehicle') {
      const s2 = s.world.residentMobility,
        v = s2?.vehicles[parsed.resourceId];
      if (!s2?.principalPolicy || !v || action.resourceId !== parsed.resourceId)
        return 'principal-resource-not-found';
      const control = resourcePrincipalSnapshot(v);
      if (v.revision !== parsed.resourceRevision || control.version !== parsed.controlVersion)
        return 'principal-resource-version-conflict';
      if (
        'operation' in parsed &&
        !samePrincipalRequest(
          vehiclePrincipalRequest(v, decodeVehiclePrincipalOperation(parsed)),
          parsed,
        )
      )
        return 'principal-resource-version-conflict';
      const subject =
        'command' in parsed && parsed.command.type === 'accept'
          ? control.offer?.target
          : control.controller;
      if (subject?.kind === 'collective' && subject.id === collectiveId) return;
      const e = subject?.kind === 'enterprise' && s.world.enterprises[subject.id],
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

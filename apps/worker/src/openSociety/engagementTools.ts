import { openWorldPolicies } from './manifest';
import { serviceEmployer } from '@aivilization/world';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  RESIDENT_SERVICE_EFFECT_MODELS,
  RESIDENT_SERVICE_EFFECTS_POLICY,
} from '@aivilization/society';
import { premisesServiceFacilityCapacity } from '@aivilization/premises';
import {
  residentServiceEngagementEvent,
  residentServiceEngagementPorts,
} from '@aivilization/world';
import type { ServiceEngagement } from '@aivilization/services';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { parseEngagementCommand } from './engagementCommands';
import { controllerAvailable, controllerVisibleTo } from './resourceControlAccess';
import { stringArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
function readable(s: OpenSocietyState, e: ServiceEngagement, actorId: string) {
  if (e.payer.sector === 'treasury') return !!s.world.publicGovernance?.authority.grant.procurement;
  const ports = residentServiceEngagementPorts(s.world, {
    authorize: () => undefined,
    controllerAvailable: () => false,
  });
  const payer = ports.account(e.payer),
    revenue = e.revenue.sector === 'enterprise' ? ports.account(e.revenue) : undefined;
  return (
    [e.providerId, e.recipientId].includes(actorId) ||
    controllerVisibleTo(s, e.controller, actorId) ||
    (payer && controllerVisibleTo(s, payer.controller, actorId)) ||
    (revenue && controllerVisibleTo(s, revenue.controller, actorId))
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
): ToolExecution {
  const d = residentServiceEngagementEvent({
    projection: s.world,
    actorId,
    command: parseEngagementCommand(name, args),
    policies: openWorldPolicies(m.seed, s.world, m.rhythm, m.canonicalPolicyContinuation),
    authorization: { authorize, controllerAvailable: (c) => controllerAvailable(s, c) },
    requestId: `engagement-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
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
export function executeEngagementTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const state = s.world.serviceEngagements;
  if (!state) throw new ToolRefusal('service-engagements-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'engagements.models')
    return result({
      policy: state.policy,
      effects: RESIDENT_SERVICE_EFFECTS_POLICY,
      ...(s.world.serviceTime
        ? {
            actualBody: s.world.serviceTime,
            note: 'Service effort, effects and natural changes share one actual interval; provider income share is not an employment wage.',
          }
        : {}),
      models: Object.values(RESIDENT_SERVICE_EFFECT_MODELS),
    });
  if (name === 'engagements.facilities')
    return result(
      pageItems(
        Object.values(s.world.locations).flatMap((l) => {
          const premises = s.world.premises;
          if (!premises) return [];
          const careStations = premisesServiceFacilityCapacity(
              premises,
              l.locationId,
              'careStations',
            ),
            teachingStations = premisesServiceFacilityCapacity(
              premises,
              l.locationId,
              'teachingStations',
            );
          return careStations + teachingStations > 0
            ? [
                {
                  locationId: l.locationId,
                  careStations,
                  teachingStations,
                  source: premises.serviceFacilityEndowments?.[l.locationId] ?? {
                    kind: 'actual-construction',
                    lookup: 'premises list',
                  },
                },
              ]
            : [];
        }),
        args,
      ),
    );
  if (name === 'engagements.list')
    return result(
      pageItems(
        Object.values(state.engagements)
          .filter((e) => readable(s, e, actorId))
          .map(({ id, title, revision, status, startAt, endAt, locationId, progressMs }) => ({
            id,
            title,
            revision,
            status,
            startAt,
            endAt,
            locationId,
            progressMs,
          })),
        args,
      ),
    );
  if (name === 'engagements.read' || name === 'engagements.ledger') {
    const e = state.engagements[stringArg(args, 'id')];
    if (!e || !readable(s, e, actorId)) throw new ToolRefusal('service-engagement-not-found');
    if (name === 'engagements.read') {
      const { educationCeiling: _ceiling, ...publicTerms } = e;
      void _ceiling;
      const employer = serviceEmployer(s.world, e.id),
        contract = employer?.serviceBusiness?.contracts[e.id];
      return result({
        ...publicTerms,
        ...(actorId === e.providerId &&
        employer &&
        contract &&
        contract.authorization.wageBasis !== 'none'
          ? {
              ownEmployment: {
                enterpriseId: employer.enterpriseId,
                expectedEmploymentRevision: contract.revision,
                phase: contract.phase,
                wageBasis: contract.authorization.wageBasis,
                referenceWage: contract.authorization.wageOffer,
                referenceSeconds: contract.authorization.wageTerms
                  ? contract.authorization.wageTerms.referenceMs / 1000
                  : s.world.residentLabor?.configuration.pay?.referenceSeconds,
                readWith: `town business service --enterprise-id ${employer.enterpriseId} --service-id ${e.id}`,
                startWith: `town engagements start --id ${e.id} --expected-revision ${e.revision} --expected-employment-revision ${contract.revision} --until SIMULATION_TIME`,
              },
            }
          : {}),
      });
    }
    return result(
      pageItems(
        Object.values(state.settlements)
          .filter((f) => f.engagementId === e.id)
          .map((f) => {
            // Explicit financial/time projection: new nested body proofs must never leak through a rest spread.
            return {
              id: f.id,
              engagementId: f.engagementId,
              at: f.at,
              from: f.from,
              until: f.until,
              previousProgressMs: f.previousProgressMs,
              progressMs: f.progressMs,
              consumed: f.consumed,
              charge: f.charge,
              providerPay: f.providerPay,
              revenuePay: f.revenuePay,
              ...(actorId === e.providerId
                ? { ownBefore: f.providerBefore, ownAfter: f.providerAfter }
                : {}),
              ...(actorId === e.recipientId
                ? { ownBefore: f.recipientBefore, ownAfter: f.recipientAfter }
                : {}),
            };
          }),
        args,
      ),
    );
  }
  return execute(s, m, actorId, name, args, requestId, personalControlAuthorization(actorId));
}
function collectiveArgs(s: OpenSocietyState, cid: string, action: CollectiveResourceAction) {
  if (
    !['engagements.offer', 'engagements.fund', 'engagements.cancel'].includes(action.capability) ||
    Object.hasOwn(action.arguments, 'id')
  )
    throw new ToolRefusal('unsupported-collective-service-action');
  const args = { ...action.arguments, id: action.resourceId },
    c = parseEngagementCommand(action.capability, args),
    e = s.world.serviceEngagements?.engagements[action.resourceId];
  const controller =
    c.type === 'offer'
      ? c.controller
      : c.type === 'fund' && e
        ? e.payer.sector === 'treasury'
          ? undefined
          : residentServiceEngagementPorts(s.world, {
              authorize: () => undefined,
              controllerAvailable: () => false,
            }).account(e.payer)?.controller
        : e?.controller;
  if (!s.world.serviceEngagements || controller?.kind !== 'collective' || controller.id !== cid)
    throw new ToolRefusal('collective-service-controller-mismatch');
  return args;
}
export function validateEngagementResourceAction(
  s: OpenSocietyState,
  cid: string,
  action: CollectiveResourceAction,
) {
  try {
    collectiveArgs(s, cid, action);
    return undefined;
  } catch (e) {
    return e instanceof ToolRefusal ? e.reason : 'invalid-collective-service-action';
  }
}
export function executeApprovedEngagementResource(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  cid: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
) {
  return execute(
    s,
    m,
    actorId,
    action.capability,
    collectiveArgs(s, cid, action),
    requestId,
    (c) => (c.kind === 'collective' && c.id === cid ? { actorId, decisionId } : undefined),
  );
}

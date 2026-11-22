import type { ControlAuthorizationPort } from '@aivilization/authority';
import { ownStudyContext } from './studyContext';
import { ownLaborContext } from './laborContext';
import { experiencePeople } from './readingExperiences';
import { ownRestContext } from './restContext';
import { createCommandEnvelope, type CoreCommandType } from '@aivilization/sim-core';
import {
  dispatchWorldCommand,
  resolveAgentRegion,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { CANONICAL_EDUCATION_RATE_PER_SECOND } from '../educationOpportunityCost';
import { OPEN_WORLD_TOOLS } from './catalog';
import type { OpenSocietyManifest, OpenSocietyState, ResidentExperience } from './types';
import { applyOpenSocietyEffects } from './state';
import { digest } from './journal';
import { ToolRefusal } from './arguments';

export function dispatchOpenWorldCommand(input: {
  enterpriseAuthorization?: ControlAuthorizationPort;
  state: OpenSocietyState;
  manifest: OpenSocietyManifest;
  policies: WorldCommandPolicies;
  actorId: string;
  requestId: string;
  commandType: CoreCommandType;
  payload: unknown;
}) {
  return dispatchWorldCommand({
    ...(input.enterpriseAuthorization
      ? { enterpriseAuthorization: input.enterpriseAuthorization }
      : {}),
    projection: input.state.world,
    policies: input.policies,
    nextSequence: input.state.worldSequence + 1,
    command: createCommandEnvelope({
      id: `open-${digest([input.actorId, input.requestId]).slice(0, 32)}`,
      simulationId: input.manifest.simulationId,
      actorId: input.actorId,
      type: input.commandType,
      source: input.commandType === 'AdvanceSimulationTime' ? 'system' : 'agent-runtime',
      payload: input.payload,
      issuedAt: input.state.world.clock.now,
    }),
  });
}
export function executeOpenWorldTool(input: {
  enterpriseAuthorization?: ControlAuthorizationPort;
  state: OpenSocietyState;
  manifest: OpenSocietyManifest;
  policies: WorldCommandPolicies;
  actorId: string;
  requestId: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
}) {
  const definition = OPEN_WORLD_TOOLS.find((tool) => tool.name === input.name);
  if (definition === undefined) throw new ToolRefusal('unknown-world-capability');
  const payload = {
    ...input.args,
    ...(definition.commandType === 'AgentTrade' && input.policies.regionalMarkets?.enabled
      ? {
          regionId: resolveAgentRegion({
            projection: input.state.world,
            agentLocationId: input.state.world.agents[input.actorId]?.locationId ?? null,
          }),
        }
      : {}),
    ...(definition.commandType === 'AgentStudy'
      ? { educationRatePerSecond: CANONICAL_EDUCATION_RATE_PER_SECOND }
      : {}),
  };
  const events = dispatchOpenWorldCommand({
    ...input,
    commandType: definition.commandType,
    payload,
  });
  const rejected = events.find((event) => event.type === 'ActionRejected');
  const next = applyOpenSocietyEffects(input.state, { worldEvents: events });
  return {
    effects: {
      worldEvents: events,
      experiences: worldExperiences(input.state, events, input.actorId),
    },
    error: rejected?.payload.reason,
    data: {
      status:
        rejected !== undefined
          ? 'rejected'
          : (next.world.activityTimeByAgent[input.actorId]?.availableAt ?? 0) > next.world.clock.now
            ? 'in-progress'
            : 'completed',
      events: events
        .filter((event) => event.type !== 'ShortTermMemoryRecorded')
        .map((event) => ({ id: event.id, type: event.type })),
      activity: next.world.activityTimeByAgent[input.actorId] ?? null,
      travel: next.world.transitByAgent?.[input.actorId] ?? null,
      ...(next.world.residentRest ? { rest: ownRestContext(next.world, input.actorId) } : {}),
      ...(next.world.residentStudy ? { study: ownStudyContext(next.world, input.actorId) } : {}),
      ...(next.world.residentLabor ? { labor: ownLaborContext(next.world, input.actorId) } : {}),
    },
  };
}

/** Only participants receive private outcomes. No global events are injected as omniscient memories. */
export function worldExperiences(
  state: OpenSocietyState,
  events: readonly WorldEvent[],
  actorId?: string,
): ResidentExperience[] {
  const experiences: ResidentExperience[] = [];
  for (const event of events) {
    if (event.type === 'ShortTermMemoryRecorded') continue;
    // Clock-driven bookkeeping is current state in `self` (physiology, balance, upkeepArrears), not
    // a memory per tick. These four used to make up ~95% of a mature town's experiences, drowning
    // real events in memory search and making every commit slower.
    if (
      actorId === undefined &&
      (event.type === 'ResidentialUpkeepCharged' ||
        event.type === 'ResidentialUpkeepArrearsUpdated' ||
        event.type === 'SubsidyPaid' ||
        (event.type === 'PhysiologyChanged' && event.payload.reason === 'elapsed-physiology'))
    )
      continue;
    // Body/session progress is an own bounded action query, not a per-minute memory broadcast.
    if (event.type === 'ResidentRestSessionChanged') continue;
    if (event.type === 'ResidentStudyCommitted' && event.payload.actorId === 'system') continue;
    if (
      (event.type === 'ResidentLaborCommitted' || event.type === 'PublicLaborCommitted') &&
      event.payload.actorId === 'system'
    )
      continue;
    const payload: unknown = event.payload;
    const participants = new Set<string>(
      event.type === 'ResidentPremisesCommitted'
        ? event.payload.efforts
            .map((e) => e.actorId)
            .filter((id) => Object.hasOwn(state.residents, id))
        : event.type === 'ResidentMaterialsCommitted'
          ? event.payload.events
              .flatMap((e) =>
                e.type === 'MaterialReceiptRecorded'
                  ? [e.receipt.actorId, ...e.receipt.efforts.map((v) => v.actorId)]
                  : [],
              )
              .filter((id) => Object.hasOwn(state.residents, id))
          : event.type === 'ResidentCommonAccountsCommitted'
            ? event.payload.transactions
                .flatMap((t) =>
                  t.entries
                    .filter((e) => e.account.sector === 'agent')
                    .map((e) => e.account.accountId.slice('agent:'.length)),
                )
                .filter((id) => Object.hasOwn(state.residents, id))
            : event.type === 'ResidentCommerceCommitted'
              ? experiencePeople(state, event.payload.events)
              : [],
    );
    if (actorId !== undefined && state.residents[actorId] !== undefined) participants.add(actorId);
    if (payload !== null && typeof payload === 'object') {
      for (const field of [
        'agentId',
        'sourceAgentId',
        'targetAgentId',
        'borrowerId',
        'employeeAgentId',
      ]) {
        const id: unknown = (payload as Record<string, unknown>)[field];
        if (typeof id === 'string' && state.residents[id] !== undefined) participants.add(id);
      }
    }
    for (const ownerId of participants)
      experiences.push({
        id: `experience-${event.id}-${ownerId}`,
        ownerId,
        at: event.occurredAt,
        kind: actorId === undefined ? 'observation' : 'action',
        summary: `${event.type}: ${JSON.stringify(personalEventPayload(event, ownerId))}`,
        sourceIds: [event.id],
        people: [...participants],
        locationIds:
          payload !== null && typeof payload === 'object'
            ? Object.entries(payload)
                .filter(
                  ([key, value]) =>
                    ['locationId', 'fromLocationId', 'toLocationId', 'targetLocationId'].includes(
                      key,
                    ) && typeof value === 'string',
                )
                .map(([, value]) => String(value))
            : [],
        provenance: 'firsthand',
      });
  }
  return experiences;
}

function personalEventPayload(event: WorldEvent, ownerId: string): unknown {
  if (event.type === 'PublicLaborCommitted') {
    const session = event.payload.events.at(-1)?.session;
    return session?.actorId === ownerId
      ? {
          id: session.id,
          status: session.status,
          source: session.terms.sourceKind,
          earned: session.earnedMicros / 1e6,
          paidGross: session.paidMicros / 1e6,
          lookup: `town city observe --view labor --section ${session.id}`,
        }
      : {};
  }
  if (event.type === 'ResidentPremisesCommitted')
    return {
      efforts: event.payload.efforts.filter((e) => e.actorId === ownerId),
      projects: event.payload.events.flatMap((e) =>
        e.type === 'ConstructionProjectChanged' &&
        (e.project.createdBy === ownerId ||
          e.project.session?.actorId === ownerId ||
          event.payload.efforts.some((v) => v.projectId === e.project.id && v.actorId === ownerId))
          ? [
              {
                id: e.project.id,
                status: e.project.status,
                revision: e.project.revision,
                progressMs: e.project.progressMs,
                lastStop: e.project.lastStop ?? null,
                settlementBlock: e.project.settlementBlock ?? null,
              },
            ]
          : [],
      ),
      salvage: event.payload.events.filter(
        (e) => e.type === 'PremisesSalvageCollected' && e.actorId === ownerId,
      ),
      buildings: event.payload.events.flatMap((e) =>
        e.type === 'PremisesBuildingChanged' &&
        (e.building.control.policyVersion === 'resource-principals-v2'
          ? e.building.control.authorization.actorId === ownerId
          : e.building.control.changedBy === ownerId)
          ? [
              {
                id: e.building.id,
                revision: e.building.revision,
                status: e.building.status,
                condition: e.building.condition,
              },
            ]
          : [],
      ),
    };
  if (event.type === 'ResidentMaterialsCommitted')
    return {
      receipts: event.payload.events.flatMap((e) =>
        e.type === 'MaterialReceiptRecorded' &&
        (e.receipt.actorId === ownerId || e.receipt.efforts.some((v) => v.actorId === ownerId))
          ? [e.receipt]
          : [],
      ),
    };
  if (event.type === 'ResidentCommonAccountsCommitted')
    return {
      receipts: event.payload.events.flatMap((e) =>
        e.type === 'CommonAccountReceiptRecorded' &&
        (e.receipt.actorId === ownerId ||
          e.receipt.transaction?.entries.some((v) => v.account.accountId === `agent:${ownerId}`))
          ? [e.receipt]
          : [],
      ),
    };
  if (event.type === 'ResidentCommerceCommitted')
    return {
      events: event.payload.events.filter((e) => {
        const states = { residents: { [ownerId]: true } };
        return experiencePeople(states, e).includes(ownerId);
      }),
    };
  const payload: unknown = event.payload;
  if (payload === null || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const personalKeys =
    record.agentId === ownerId
      ? [
          'previousBalance',
          'nextBalance',
          'amount',
          'previous',
          'next',
          'status',
          'commandType',
          'side',
          'commodityQuantity',
          'currencyQuantity',
          'effectivePrice',
          'regionId',
          'fromLocationId',
          'toLocationId',
          'targetLocationId',
          'startedAt',
          'availableAt',
          'durationSeconds',
          'activity',
          'loanId',
          'occupationName',
          'previousJob',
          'nextJob',
          'produced',
          'consumedInputs',
          'energyCost',
          'satietyCost',
          'laborSeconds',
        ]
      : [];
  // Shared outcome labels are observable, counterpart balances and global accounting entries are not.
  return Object.fromEntries(
    Object.entries(record).filter(([key]) =>
      [
        ...personalKeys,
        'agentId',
        'sourceAgentId',
        'targetAgentId',
        'commodityName',
        'quantity',
        'enterpriseId',
        'locationId',
        'reason',
      ].includes(key),
    ),
  );
}

import { experiencePeople } from './readingExperiences';
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
  state: OpenSocietyState;
  manifest: OpenSocietyManifest;
  policies: WorldCommandPolicies;
  actorId: string;
  requestId: string;
  commandType: CoreCommandType;
  payload: unknown;
}) {
  return dispatchWorldCommand({
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
    const payload: unknown = event.payload;
    const participants = new Set<string>(
      event.type === 'ResidentCommerceCommitted'
        ? experiencePeople(state, event.payload.events)
        : event.type === 'ResidentMobilityCommitted'
          ? event.payload.events.flatMap((e) =>
              e.type === 'RideChanged'
                ? [e.value.riderId, ...(e.value.driverId ? [e.value.driverId] : [])]
                : e.type === 'RideQuoteChanged'
                  ? [
                      e.value.driverId,
                      ...(state.world.residentMobility?.rides[e.value.rideId]
                        ? [state.world.residentMobility.rides[e.value.rideId]!.riderId]
                        : []),
                    ]
                  : e.type === 'DriverChanged'
                    ? [e.value.id]
                    : [e.value.ownerId, ...e.value.authorized],
            )
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
        summary: `${event.type}: ${JSON.stringify(personalEventPayload(event, ownerId, state))}`,
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

function personalEventPayload(
  event: WorldEvent,
  ownerId: string,
  state: OpenSocietyState,
): unknown {
  if (event.type === 'ResidentMobilityCommitted')
    return {
      events: event.payload.events.filter((e) =>
        e.type === 'RideChanged'
          ? e.value.riderId === ownerId || e.value.driverId === ownerId
          : e.type === 'RideQuoteChanged'
            ? e.value.driverId === ownerId ||
              state.world.residentMobility?.rides[e.value.rideId]?.riderId === ownerId
            : e.type === 'DriverChanged'
              ? e.value.id === ownerId
              : e.value.ownerId === ownerId || e.value.authorized.includes(ownerId),
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

import {
  PUBLIC_LABOR_POLICY,
  assertPublicLaborPolicy,
  initialOccupationNames,
  quoteEarnedLaborCompensation,
  calculateLaborPay,
  startPublicLabor,
  stopPublicLabor,
  progressPublicLabor,
  applyPublicLaborEvent,
  publicLaborBody,
  type PublicLaborEvent,
  type PublicLaborBody,
} from '@aivilization/society';
import { createEventEnvelope, type CommandEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { WorldCommandPolicies } from './agentActions';
import type { PublicLaborConfiguration } from './publicLaborModel';
import { publicLaborTransactions } from './publicLaborAccounting';
import { assertResidentRestTimeCompatibility } from './residentRestTime';
import { mayEnterWorldPremises, premisesAtLocation, worldPremisesUseUntil } from './premisesAccess';
import { assertAgentWorkPayload } from './commands';
import {
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
  makeMemoryEvent,
} from './handlers/shared';
type Context = {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
};
export function assertPublicLaborConfiguration(w: WorldProjection, c: PublicLaborConfiguration) {
  assertPublicLaborPolicy(c.policy);
  calculateLaborPay(1, 1, c.pay);
  const names = initialOccupationNames();
  if (
    !w.residentRest ||
    w.treasury === undefined ||
    c.sourceId !== 'initial-public-employment-v1' ||
    !c.locationIds.length ||
    new Set(c.locationIds).size !== c.locationIds.length ||
    c.locationIds.some(
      (id) => !w.locations[id]?.activityAffinities.includes('work') || premisesAtLocation(w, id),
    ) ||
    Object.keys(c.occupationWages).length !== names.length ||
    names.some(
      (n) =>
        !Object.hasOwn(c.occupationWages, n) ||
        !Number.isFinite(c.occupationWages[n]) ||
        c.occupationWages[n]! < 0,
    ) ||
    ![
      c.effort.energyCostPerHour,
      c.effort.satietyCostPerHour,
      c.body.decay.energyPerHour,
      c.body.decay.satietyPerHour,
      c.body.critical.energy,
      c.body.critical.health,
      ...Object.values(c.body.deprivation ?? {}),
    ].every((n) => Number.isFinite(n) && n >= 0) ||
    (c.body.deprivation?.minHealth ?? 0) > 100
  )
    throw Error('invalid-public-labor-configuration');
}
export function enablePublicLaborEvent(
  input: Context & { policies: WorldCommandPolicies },
): WorldEvent {
  const w = input.projection,
    p = input.policies;
  assertResidentRestTimeCompatibility(p);
  if (
    w.publicLabor ||
    !p.laborPay ||
    Object.values(w.activityTimeByAgent).some(
      (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
    )
  )
    throw Error('public-labor-requires-period-pay-and-no-prepaid-activity');
  const configuration: PublicLaborConfiguration = {
    policy: PUBLIC_LABOR_POLICY,
    sourceId: 'initial-public-employment-v1',
    pay: { ...p.laborPay },
    effort: { ...p.laborCost },
    body: {
      decay: p.calendar?.physiologicalDecay ?? { energyPerHour: 0, satietyPerHour: 0 },
      critical: { ...p.criticalThresholds },
      ...(p.sleepDeprivation ? { deprivation: p.sleepDeprivation } : {}),
    },
    locationIds: Object.values(w.locations)
      .filter((l) => l.activityAffinities.includes('work') && !premisesAtLocation(w, l.locationId))
      .map((l) => String(l.locationId))
      .sort(),
    occupationWages: Object.fromEntries(
      initialOccupationNames().map((name) => [name, p.wageCalculator(name)]),
    ),
  };
  assertPublicLaborConfiguration(w, configuration);
  return createEventEnvelope({
    id: `${input.requestId}:public-labor-enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'PublicLaborEnabled',
    payload: configuration,
  });
}
/** Physical rates are shared by every activity; a runtime change requires an explicit migration. */
export function assertPublicLaborTimePolicy(
  w: WorldProjection,
  p: Pick<WorldCommandPolicies, 'calendar' | 'sleepDeprivation'>,
) {
  const body = w.publicLabor?.configuration.body;
  if (!body) return;
  const decay = p.calendar?.physiologicalDecay ?? { energyPerHour: 0, satietyPerHour: 0 };
  const same = (a: object | undefined, b: object | undefined) =>
    a === undefined || b === undefined
      ? a === b
      : Object.keys(a).length === Object.keys(b).length &&
        Object.entries(a).every(
          ([key, value]) => Object.hasOwn(b, key) && Reflect.get(b, key) === value,
        );
  if (!same(body.decay, decay) || !same(body.deprivation, p.sleepDeprivation))
    throw Error('public-labor-physiology-policy-mismatch');
}
export function hasPrivateEmployment(w: WorldProjection, actorId: string): boolean {
  return Object.values(w.enterprises).some((e) => e.employeeAgentIds.some((id) => id === actorId));
}
export function publicLaborAvailability(w: WorldProjection, id: string, through: number) {
  const state = w.publicLabor,
    s = state?.process.sessions[id],
    a = s && w.agents[s.actorId];
  if (!state || !s || !a || a.job !== s.terms.occupation || hasPrivateEmployment(w, s.actorId))
    return 'employment-ended' as const;
  const at = { ...w, clock: { ...w.clock, now: through } };
  if (
    a.locationId !== s.locationId ||
    w.transitByAgent?.[s.actorId] ||
    !mayEnterWorldPremises(at, s.actorId, s.locationId) ||
    worldPremisesUseUntil(at, s.actorId, s.locationId, 'entry', s.settledAt) <
      Math.min(through, s.until)
  )
    return 'permission-ended' as const;
  return undefined;
}
export function publicLaborCommit(
  input: Context & {
    actorId: string;
    at: number;
    events: readonly PublicLaborEvent[];
    body?: PublicLaborBody;
  },
): WorldEvent {
  const id = `${input.requestId}:public-labor`;
  if (!input.projection.publicLabor) throw Error('public-labor-not-enabled');
  return createEventEnvelope({
    id,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.at,
    type: 'PublicLaborCommitted',
    payload: {
      policyVersion: PUBLIC_LABOR_POLICY.version,
      actorId: input.actorId,
      events: input.events,
      ...(input.body ? { body: input.body } : {}),
      transactions: publicLaborTransactions(input.projection.publicLabor.process, input.events, id),
    },
  });
}
export function handlePublicLabor(input: {
  projection: WorldProjection;
  command: CommandEnvelope<'AgentWork' | 'AgentStopWork', unknown>;
  policies: WorldCommandPolicies;
  nextSequence: number;
}): WorldEvent[] {
  const w = input.projection,
    state = w.publicLabor,
    a = resolveCommandAgent(w, input.command);
  const reject = (reason: string) => rejectCommand(input, input.command.type, reason);
  if (!state) return reject('public-labor-not-enabled');
  const parsed = parsePayload(() => {
    let events: readonly PublicLaborEvent[];
    if (input.command.type === 'AgentWork') {
      const p = assertAgentWorkPayload(input.command.payload),
        c = state.configuration;
      if (
        p.enterpriseId !== undefined ||
        hasPrivateEmployment(w, a.agentId) ||
        a.job !== p.occupationName ||
        !Object.hasOwn(c.occupationWages, p.occupationName)
      )
        throw Error('current-public-employment-required');
      if (
        !a.locationId ||
        !c.locationIds.includes(a.locationId) ||
        w.transitByAgent?.[a.agentId] ||
        !mayEnterWorldPremises(w, a.agentId, a.locationId)
      )
        throw Error('actual-public-workplace-required');
      if ((w.activityTimeByAgent[a.agentId]?.availableAt ?? 0) > w.clock.now)
        throw Error('public-worker-busy');
      if (
        a.physiology.energy <= c.body.critical.energy ||
        a.physiology.health <= c.body.critical.health
      )
        throw Error('public-worker-physically-unavailable');
      if (
        worldPremisesUseUntil(w, a.agentId, a.locationId, 'entry') <
        w.clock.now + p.laborSeconds * 1000
      )
        throw Error('public-labor-entry-window-exceeded');
      const quotedWage = c.occupationWages[p.occupationName]!;
      const d = startPublicLabor({
        state: state.process,
        id: `public-work-${input.nextSequence}`,
        actorId: a.agentId,
        locationId: a.locationId,
        at: w.clock.now,
        durationMs: p.laborSeconds * 1000,
        availableTreasuryMicros: Math.floor((w.treasury ?? 0) * 1e6),
        terms: {
          ...quoteEarnedLaborCompensation({
            quotedWage,
            laborSeconds: p.laborSeconds,
            pay: c.pay,
            ...(input.policies.tax ? { tax: input.policies.tax } : {}),
          }),
          sourceKind: c.policy.source,
          sourceId: c.sourceId,
          occupation: p.occupationName,
          quotedWage,
          referenceSeconds: c.pay.referenceSeconds,
          ...c.effort,
        },
      });
      if (!d.accepted) throw Error(d.reason);
      events = d.events;
    } else {
      const p = input.command.payload as { id?: unknown; expectedRevision?: unknown };
      if (
        !p ||
        typeof p.id !== 'string' ||
        typeof p.expectedRevision !== 'number' ||
        Object.keys(p).some((k) => !['id', 'expectedRevision'].includes(k))
      )
        throw Error('invalid-public-labor-stop-payload');
      const d = stopPublicLabor({
        state: state.process,
        id: p.id,
        actorId: a.agentId,
        expectedRevision: p.expectedRevision,
        at: w.clock.now,
      });
      if (!d.accepted) throw Error(d.reason);
      events = d.events;
    }
    return publicLaborCommit({
      projection: w,
      actorId: a.agentId,
      at: w.clock.now,
      events,
      simulationId: input.command.simulationId,
      requestId: input.command.id,
      nextSequence: input.nextSequence,
    });
  });
  if (parsed.status === 'invalid') return reject(parsed.reason);
  return [
    parsed.payload,
    makeMemoryEvent(input, 1, {
      summary:
        input.command.type === 'AgentWork'
          ? 'Started actual initial public labor. The treasury reserved the promised wage; payment follows actual time, without manufactured products or service.'
          : 'Stopped future public labor; earned pay remains mine and unearned funding returned to the treasury.',
      status: 'succeeded',
      tags: ['actual-public-labor'],
    }),
  ];
}
export function settlePublicLaborInterval(
  input: Context & { actorId: string; from: number; until: number },
): WorldEvent[] {
  const w = input.projection,
    state = w.publicLabor,
    id = state?.process.activeByActor[input.actorId],
    s = id && state?.process.sessions[id];
  if (!state || !s) return [];
  const actor = w.agents[input.actorId];
  if (!actor) throw Error('public-worker-missing');
  const reason = publicLaborAvailability(w, s.id, input.until),
    body = publicLaborBody({
      session: s,
      policy: state.configuration.body,
      previous: actor.physiology,
      from: input.from,
      until: input.until,
      available: !reason,
    });
  let process = state.process;
  const events: PublicLaborEvent[] = [];
  const d = progressPublicLabor(process, s.id, input.from + body.workedMs);
  if (!d.accepted) throw Error(d.reason);
  for (const event of d.events) {
    process = applyPublicLaborEvent(process, event);
    events.push(event);
  }
  const current = process.sessions[s.id]!;
  if (current.status === 'active' && (reason || body.physicallyEnded)) {
    const end = stopPublicLabor({
      state: process,
      id: s.id,
      actorId: 'system',
      at: current.settledAt,
      expectedRevision: current.revision,
      reason: reason ?? 'physical-unavailable',
    });
    if (!end.accepted) throw Error(end.reason);
    events.push(...end.events);
  }
  if (!events.length) throw Error('public-labor-interval-produced-no-progress');
  return [publicLaborCommit({ ...input, actorId: 'system', at: input.until, events, body })];
}

export function stopUnavailablePublicLabor(input: Context & { at: number }): WorldEvent[] {
  let w = input.projection;
  const events: WorldEvent[] = [];
  for (const actorId of Object.keys(w.publicLabor?.process.activeByActor ?? {}).sort()) {
    const process = w.publicLabor!.process,
      id = process.activeByActor[actorId]!,
      s = process.sessions[id]!;
    const reason = publicLaborAvailability(w, id, input.at);
    if (!reason) continue;
    const d = stopPublicLabor({
      state: process,
      id,
      actorId: 'system',
      at: s.settledAt,
      expectedRevision: s.revision,
      reason,
    });
    if (!d.accepted) throw Error(d.reason);
    const event = publicLaborCommit({
      ...input,
      projection: w,
      actorId: 'system',
      events: d.events,
      requestId: `${input.requestId}-${events.length}`,
      nextSequence: input.nextSequence + events.length,
    });
    w = applyWorldEvent(w, event);
    events.push(event);
  }
  return events;
}

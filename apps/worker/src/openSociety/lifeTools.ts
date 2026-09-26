import { personalProviderOverlap } from '@aivilization/services';
import {
  decideHousehold,
  decideCare,
  canReadHealth,
  decideHealthRecord,
  decideLearningAssessment,
  type HouseholdCommand,
  type CareCommand,
  type HealthRecordCommand,
  type ResidentLeaseCommand,
} from '@aivilization/society';
import {
  reserveResidentParticipation,
  residentLeaseCommand,
  resolveAgentResidenceLocationId,
  resolveResidentialOccupancy,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { stringArg, stringArrayArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { applyOpenSocietyEffects } from './state';
import { digest } from './journal';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
export function executeLifeTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  policies: WorldCommandPolicies,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.life;
  if (!s) throw new ToolRefusal('life-not-enabled');
  const id = stringArg(args, 'id'),
    expectedRevision = numberArg(args, 'expectedRevision'),
    at = state.world.clock.now;
  const exists = (id: string) => Object.hasOwn(state.residents, id);
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const residence = (id: string) =>
    state.world.agents[id]
      ? resolveAgentResidenceLocationId(state.world, state.world.agents[id])
      : undefined;
  if (name === 'population.self') {
    const agent = state.world.agents[actorId]!;
    return result({
      agentId: actorId,
      lifeStage: agent.lifeStage ?? 'adult',
      registration: agent.registration ?? null,
      retiredAt: agent.retiredAtMs ?? null,
      policy: policies.lifecycle ?? null,
    });
  }
  if (name === 'households.list')
    return result(
      pageItems(
        Object.values(s.households.links).filter(
          (l) => l.proposerId === actorId || l.partnerId === actorId,
        ),
        args,
      ),
    );
  if (name.startsWith('households.')) {
    const op = name.slice(11);
    let c: HouseholdCommand;
    if (op === 'propose')
      c = {
        type: 'propose',
        id,
        partnerId: stringArg(args, 'partnerId'),
        kind: stringArg(args, 'kind') as 'family' | 'guardianship' | 'cohabitation',
        terms: stringArg(args, 'terms'),
      };
    else if (op === 'accept' || op === 'reject' || op === 'end')
      c = { type: op, id, expectedRevision };
    else throw new ToolRefusal('unknown-household-command');
    const d = decideHousehold(s.households, actorId, at, c, {
      exists,
      cohabiting: (a, b) => residence(a) !== undefined && residence(a) === residence(b),
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return { data: d.events, effects: { householdEvents: d.events } };
  }
  if (name === 'care.list')
    return result(
      pageItems(
        Object.values(s.care.tasks).filter(
          (t) => t.recipientId === actorId || t.providerId === actorId,
        ),
        args,
      ),
    );
  if (name.startsWith('care.')) {
    const op = name.slice(5);
    let c: CareCommand;
    if (op === 'request')
      c = {
        type: 'request',
        id,
        providerId: stringArg(args, 'providerId'),
        locationId: stringArg(args, 'locationId'),
        description: stringArg(args, 'description'),
        durationMs: numberArg(args, 'durationMs'),
      };
    else if (op === 'accept' || op === 'start' || op === 'cancel')
      c = { type: op, id, expectedRevision };
    else throw new ToolRefusal('unknown-care-command');
    const d = decideCare(s.care, actorId, at, c, {
      exists,
      locationExists: (id) => Object.hasOwn(state.world.locations, id),
      presentAndIdle: (id, loc) =>
        state.world.agents[id]?.locationId === loc &&
        !state.world.transitByAgent?.[id] &&
        (state.world.activityTimeByAgent[id]?.availableAt ?? 0) <= at,
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    const worldEvents: WorldEvent[] = [];
    let working = state;
    if (d.participation)
      for (const participant of d.participation.participants) {
        const event = reserveResidentParticipation({
          projection: working.world,
          actorId: participant,
          locationId: d.participation.locationId,
          until: d.participation.until,
          simulationId: manifest.simulationId,
          requestId: `care-${digest([requestId, participant]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        });
        worldEvents.push(event);
        working = applyOpenSocietyEffects(working, { worldEvents: [event] });
      }
    return {
      data: d.events,
      effects: { careEvents: d.events, ...(worldEvents.length ? { worldEvents } : {}) },
    };
  }
  if (name === 'health.records') {
    const patientId = stringArg(args, 'patientId');
    if (!canReadHealth(s.health, actorId, patientId))
      throw new ToolRefusal('patient-authorization-required');
    return result(
      pageItems(
        Object.values(s.health.records).filter((r) => r.patientId === patientId),
        args,
      ),
    );
  }
  if (name.startsWith('health.')) {
    const op = name.slice(7);
    let c: HealthRecordCommand;
    if (op === 'grant' || op === 'revoke') c = { type: op, targetId: stringArg(args, 'targetId') };
    else if (op === 'record')
      c = {
        type: 'record',
        id,
        patientId: stringArg(args, 'patientId'),
        kind: stringArg(args, 'kind') as 'note' | 'treatment' | 'medication' | 'follow-up',
        content: stringArg(args, 'content'),
        sourceEventIds: stringArrayArg(args, 'sourceEventIds'),
      };
    else throw new ToolRefusal('unknown-health-command');
    const d = decideHealthRecord(s.health, actorId, at, c, {
      exists,
      ownsSource: (patient, eventId) =>
        (state.experiences[patient] ?? []).some(
          (e) =>
            e.sourceIds.includes(eventId) &&
            e.summary.startsWith('PhysiologyChanged:') &&
            e.summary.includes('see-doctor'),
        ),
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return { data: d.events, effects: { healthRecordEvents: d.events } };
  }
  if (name === 'courses.records')
    return result(
      pageItems(
        Object.values(s.learning.assessments).filter(
          (r) => r.teacherId === actorId || r.learnerId === actorId,
        ),
        args,
      ),
    );
  if (name === 'courses.assess') {
    const bookingId = stringArg(args, 'bookingId'),
      b = state.services?.bookings[bookingId],
      slot = b ? state.services?.slots[b.slotId] : undefined,
      service = slot ? state.services?.services[slot.serviceId] : undefined;
    const evidence =
      b &&
      service?.kind === 'course' &&
      (state.services?.policy.version !== 'resident-services-v3' ||
        (slot &&
          b.checkedInAt !== undefined &&
          personalProviderOverlap(
            slot,
            actorId,
            b.checkedInAt,
            b.endedAt ?? b.attendingUntil ?? slot.end,
          ) > 0))
        ? {
            teacherId:
              state.services?.policy.version === 'resident-services-v3' ? actorId : service.ownerId,
            learnerId: b.residentId,
            completed:
              b.status === 'completed' ||
              (b.status === 'ended' && (b.attendedMs ?? 0) > 0 && (b.providerOverlapMs ?? 0) > 0),
          }
        : undefined;
    const d = decideLearningAssessment(
      s.learning,
      actorId,
      at,
      { id, bookingId, content: stringArg(args, 'content') },
      evidence,
    );
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return { data: d.events, effects: { learningEvents: d.events } };
  }
  if (name === 'leases.list')
    return result(
      pageItems(
        Object.values(state.world.residentLeases?.leases ?? {}).filter(
          (l) => l.hostId === actorId || l.tenantId === actorId,
        ),
        args,
      ),
    );
  if (name.startsWith('leases.')) {
    const op = name.slice(7);
    let c: ResidentLeaseCommand;
    if (op === 'offer')
      c = {
        type: 'offer',
        id,
        tenantId: stringArg(args, 'tenantId'),
        locationId: stringArg(args, 'locationId'),
        terms: stringArg(args, 'terms'),
        rent: numberArg(args, 'rent'),
        deposit: numberArg(args, 'deposit'),
        expiresAt: numberArg(args, 'expiresAt'),
      };
    else if (op === 'accept' || op === 'end' || op === 'pay')
      c = { type: op, id, expectedRevision };
    else throw new ToolRefusal('unknown-lease-command');
    const d = residentLeaseCommand({
      projection: state.world,
      policies,
      actorId,
      command: c,
      simulationId: manifest.simulationId,
      requestId: `lease-${digest([actorId, requestId]).slice(0, 24)}`,
      nextSequence: state.worldSequence + 1,
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return {
      data: d.events.filter((e) => e.type === 'ResidentLeaseChanged').map((e) => e.payload),
      effects: { worldEvents: d.events },
    };
  }
  if (name === 'housing.list')
    return result(
      pageItems(
        Object.values(state.world.locations)
          .filter((l) => l.kind === 'residence')
          .map((l) => ({
            id: l.locationId,
            name: l.name,
            capacity: l.capacity,
            occupied: resolveResidentialOccupancy(state.world, l.locationId),
          })),
        args,
      ),
    );
  if (name === 'civic.list') {
    const kind = stringArg(args, 'kind');
    const w = state.world;
    return result(
      pageItems<unknown>(
        kind === 'petitions'
          ? Object.values(w.petitions ?? {})
          : kind === 'matters'
            ? Object.values(w.socialMatters ?? {})
            : kind === 'commitments'
              ? Object.values(w.socialCommitments).filter(
                  (c) => c.promisorAgentId === actorId || c.beneficiaryAgentId === actorId,
                )
              : (w.bulletins ?? []),
        args,
      ),
    );
  }
  throw new ToolRefusal('unknown-life-command');
}

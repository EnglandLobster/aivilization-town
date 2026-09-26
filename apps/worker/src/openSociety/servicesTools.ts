import { isEnterpriseOperational } from '@aivilization/enterprise';
import { executeOpenWorldTool } from './worldTools';
import { openWorldPolicies } from './manifest';
import {
  decideServices,
  serviceSupply,
  personalProviderOverlap,
  type ServicesCommand,
  type ServiceKind,
  type ServicesPorts,
} from '@aivilization/services';
import { reserveResidentParticipation, endResidentParticipation } from '@aivilization/world';
import { stringArg, numberArg, pageItems, ToolRefusal } from './arguments';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { digest } from './journal';
export function executeServicesTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.services;
  if (!s) throw new ToolRefusal('services-not-enabled');
  const ports: ServicesPorts = {
    exists: (id) => Object.hasOwn(state.residents, id),
    locationCapacity: (id) => {
      const l = state.world.locations[id];
      return l === undefined ? undefined : (l.capacity ?? s.policy.maxCapacity);
    },
    presentAndIdle: (id, location) =>
      state.world.agents[id]?.locationId === location &&
      !state.world.transitByAgent?.[id] &&
      (state.world.activityTimeByAgent[id]?.availableAt ?? 0) <= state.world.clock.now,
    controlsEnterprise: (actor, id) => {
      const e = state.world.enterprises[id];
      return e !== undefined && isEnterpriseOperational(e) && e.ownerAgentId === actor;
    },
    employedBy: (actor, id) => {
      const e = state.world.enterprises[id];
      return (
        e !== undefined && isEnterpriseOperational(e) && e.employeeAgentIds.some((v) => v === actor)
      );
    },
  };
  const id = stringArg(args, 'id'),
    expectedRevision = numberArg(args, 'expectedRevision');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'services.list')
    return result(
      pageItems(
        Object.values(s.services).filter((v) => v.active),
        args,
      ),
    );
  if (name === 'services.read') {
    const v = s.services[id];
    if (!v) throw new ToolRefusal('service-not-found');
    return result({
      ...v,
      slots: pageItems(
        Object.values(s.slots)
          .filter((t) => t.serviceId === id && t.end > state.world.clock.now)
          .map((slot) => {
            const { providers: _providers, ...record } = slot;
            void _providers;
            return { ...record, supply: serviceSupply(s, slot, state.world.clock.now, ports) };
          }),
        args,
      ),
    });
  }
  if (name === 'bookings.list' || name === 'bookings.read') {
    const items = Object.values(s.bookings).filter(
      (b) =>
        b.residentId === actorId ||
        s.services[s.slots[b.slotId]!.serviceId]?.ownerId === actorId ||
        (s.policy.version === 'resident-services-v3' &&
          b.checkedInAt !== undefined &&
          personalProviderOverlap(
            s.slots[b.slotId]!,
            actorId,
            b.checkedInAt,
            Math.min(
              state.world.clock.now,
              b.endedAt ?? b.attendingUntil ?? s.slots[b.slotId]!.end,
            ),
          ) > 0),
    );
    if (name === 'bookings.list') return result(pageItems(items, args));
    const b = items.find((b) => b.id === id);
    if (!b) throw new ToolRefusal('booking-not-found');
    const { providers: _providers, ...slot } = s.slots[b.slotId]!;
    void _providers;
    return result({
      ...b,
      slot: { ...slot, supply: serviceSupply(s, s.slots[b.slotId]!, state.world.clock.now, ports) },
      service: s.services[s.slots[b.slotId]!.serviceId],
      note: 'ended means attendance ended; measured duration and provider overlap do not certify satisfaction or full contractual performance.',
    });
  }
  if (name === 'queues.status')
    return result(
      pageItems(
        Object.values(s.queues).filter(
          (q) => q.residentId === actorId || s.services[q.serviceId]?.ownerId === actorId,
        ),
        args,
      ),
    );
  let c: ServicesCommand;
  switch (name) {
    case 'services.publish':
      c = {
        type: 'publish',
        id,
        kind: stringArg(args, 'kind') as ServiceKind,
        locationId: stringArg(args, 'locationId'),
        ...(args.destinationId === undefined
          ? {}
          : { destinationId: stringArg(args, 'destinationId') }),
        title: stringArg(args, 'title'),
        description: stringArg(args, 'description'),
        capacity: numberArg(args, 'capacity'),
        ...(args.enterpriseId === undefined
          ? {}
          : { enterpriseId: stringArg(args, 'enterpriseId') }),
        ...(args.unitsPerProvider === undefined
          ? {}
          : { unitsPerProvider: numberArg(args, 'unitsPerProvider') }),
        ...(args.participationMode === undefined
          ? {}
          : {
              participationMode: stringArg(args, 'participationMode') as 'hosted' | 'self-service',
            }),
      };
      break;
    case 'services.schedule':
      c = {
        type: 'schedule',
        id,
        serviceId: stringArg(args, 'serviceId'),
        start: numberArg(args, 'start'),
        end: numberArg(args, 'end'),
        capacity: numberArg(args, 'capacity'),
      };
      break;
    case 'courses.start':
    case 'services.start':
      c = {
        type: 'start-session',
        id,
        expectedRevision,
        ...(args.until === undefined ? {} : { until: numberArg(args, 'until') }),
      };
      break;
    case 'services.stop':
      c = { type: 'stop-session', id, expectedRevision };
      break;
    case 'services.close':
      c = { type: 'close', id, expectedRevision };
      break;
    case 'bookings.request':
      c = {
        type: 'request',
        id,
        slotId: stringArg(args, 'slotId'),
        units: numberArg(args, 'units'),
      };
      break;
    case 'bookings.accept':
    case 'bookings.cancel':
    case 'bookings.check-in':
    case 'bookings.leave':
      c = {
        type: name.slice(9) as 'accept' | 'cancel' | 'check-in' | 'leave',
        id,
        expectedRevision,
        ...(args.until === undefined ? {} : { until: numberArg(args, 'until') }),
      };
      break;
    case 'queues.join':
      c = { type: 'join', id, serviceId: stringArg(args, 'serviceId') };
      break;
    case 'queues.leave':
      c = { type: 'leave', id };
      break;
    case 'queues.call':
      c = {
        type: 'call',
        id,
        slotId: stringArg(args, 'slotId'),
        bookingId: stringArg(args, 'bookingId'),
      };
      break;
    default:
      throw new ToolRefusal('unknown-services-command');
  }
  const d = decideServices(s, actorId, state.world.clock.now, c, ports);
  if (!d.accepted) throw new ToolRefusal(d.reason);
  if (d.releases) {
    const worldEvents = d.releases.map((release, index) =>
      endResidentParticipation({
        projection: state.world,
        actorId: release.residentId,
        startedAt: release.startedAt,
        expectedUntil: release.expectedUntil,
        simulationId: manifest.simulationId,
        requestId: `staffing-${digest([actorId, requestId, release.residentId]).slice(0, 24)}`,
        nextSequence: state.worldSequence + index + 1,
      }),
    );
    const experiences = d.events.flatMap((event) => {
      if (event.type !== 'BookingChanged') return [];
      const slot = s.slots[event.booking.slotId]!;
      const service = s.services[slot.serviceId]!;
      return [...new Set([event.booking.residentId, service.ownerId])].map((ownerId) => ({
        id: `experience-booking-${event.booking.id}-${event.booking.revision}-${ownerId}`,
        ownerId,
        at: state.world.clock.now,
        kind: 'observation' as const,
        summary: JSON.stringify({
          kind: 'attendance-ended',
          booking: event.booking,
          serviceId: service.id,
          locationId: service.locationId,
        }),
        sourceIds: [event.booking.id, slot.id, service.id],
        people: [event.booking.residentId, service.ownerId],
        locationIds: [service.locationId],
        provenance: 'firsthand' as const,
      }));
    });
    return { data: d.events, effects: { servicesEvents: d.events, worldEvents, experiences } };
  }
  if (d.release) {
    const worldEvent = endResidentParticipation({
      projection: state.world,
      actorId,
      startedAt: d.release.startedAt,
      expectedUntil: d.release.expectedUntil,
      simulationId: manifest.simulationId,
      requestId: `booking-${digest([actorId, requestId]).slice(0, 24)}`,
      nextSequence: state.worldSequence + 1,
    });
    return { data: d.events, effects: { servicesEvents: d.events, worldEvents: [worldEvent] } };
  }
  const booking = d.participation?.bookingId ? s.bookings[d.participation.bookingId] : undefined;
  const service = booking ? s.services[s.slots[booking.slotId]!.serviceId] : undefined;
  if (d.participation && service?.kind === 'transport') {
    const journey = executeOpenWorldTool({
      state,
      manifest,
      policies: openWorldPolicies(manifest.seed, state.world, manifest.rhythm),
      actorId,
      requestId,
      name: 'world.move',
      args: { targetLocationId: service.destinationId },
    });
    if (journey.error) throw new ToolRefusal(journey.error);
    const activity = journey.data.activity;
    if (activity && activity.availableAt > d.participation.until)
      throw new ToolRefusal('transport-slot-too-short-for-route');
    return {
      data: { events: d.events, journey: journey.data },
      effects: { ...journey.effects, servicesEvents: d.events },
    };
  }
  const worldEvents = d.participation
    ? [
        reserveResidentParticipation({
          projection: state.world,
          actorId,
          locationId: d.participation.locationId,
          until: d.participation.until,
          simulationId: manifest.simulationId,
          requestId: `booking-${digest([actorId, requestId]).slice(0, 24)}`,
          nextSequence: state.worldSequence + 1,
        }),
      ]
    : [];
  return {
    data: d.events,
    effects: { servicesEvents: d.events, ...(worldEvents.length ? { worldEvents } : {}) },
  };
}

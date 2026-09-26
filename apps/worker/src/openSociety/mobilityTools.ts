import { activeRide, authorizedDriver, type MobilityCommand } from '@aivilization/mobility';
import { residentMobilityCommand } from '@aivilization/world';
import { numberArg, pageItems, stringArg, ToolRefusal } from './arguments';
import type { ToolExecution } from './informationTools';
import type { OpenSocietyManifest, OpenSocietyState } from './types';
import { applyOpenSocietyEffects } from './state';
export function executeMobilityTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.world.residentMobility;
  if (!s) throw new ToolRefusal('mobility-not-enabled');
  const id = stringArg(args, 'id'),
    expectedRevision = numberArg(args, 'expectedRevision'),
    at = state.world.clock.now;
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const list = <T extends { id: string }>(values: T[]) =>
    result(
      pageItems(
        values.sort((a, b) => a.id.localeCompare(b.id, 'en')),
        args,
      ),
    );
  if (name === 'vehicles.list')
    return list(Object.values(s.vehicles).filter((v) => authorizedDriver(v, actorId)));
  if (name === 'vehicles.read') {
    const v = s.vehicles[id];
    if (!v || !authorizedDriver(v, actorId)) throw new ToolRefusal('vehicle-not-found');
    return result(v);
  }
  if (name === 'drivers.list')
    return list(
      Object.values(s.drivers).filter(
        (d) => d.id === actorId || (d.online && authorizedDriver(s.vehicles[d.vehicleId]!, d.id)),
      ),
    );
  const own = (r: { riderId: string; driverId?: string }) =>
    r.riderId === actorId || r.driverId === actorId;
  if (name === 'rides.list')
    return list(
      Object.values(s.rides).filter((r) =>
        stringArg(args, 'scope', 'mine') === 'open'
          ? r.status === 'requested' && r.expiresAt > at
          : own(r),
      ),
    );
  if (name === 'rides.read') {
    const r = s.rides[id];
    if (!r || (!own(r) && !(r.status === 'requested' && r.expiresAt > at)))
      throw new ToolRefusal('ride-not-found');
    return result(r);
  }
  if (name === 'rides.quotes')
    return list(
      Object.values(s.quotes).filter(
        (q) => q.rideId === id && (s.rides[id]?.riderId === actorId || q.driverId === actorId),
      ),
    );
  let command: MobilityCommand;
  switch (name) {
    case 'vehicles.authorize':
    case 'vehicles.revoke':
      command = { type: name, id, residentId: stringArg(args, 'residentId'), expectedRevision };
      break;
    case 'drivers.register':
      command = { type: name, vehicleId: stringArg(args, 'vehicleId') };
      break;
    case 'drivers.online':
    case 'drivers.offline':
      command = { type: name };
      break;
    case 'rides.request':
      command = {
        type: name,
        id,
        destinationId: stringArg(args, 'destinationId'),
        expiresAt: numberArg(args, 'expiresAt'),
      };
      break;
    case 'rides.quote':
      command = {
        type: name,
        id,
        rideId: stringArg(args, 'rideId'),
        fare: numberArg(args, 'fare'),
        expiresAt: numberArg(args, 'expiresAt'),
      };
      break;
    case 'rides.book':
      command = { type: name, id, quoteId: stringArg(args, 'quoteId'), expectedRevision };
      break;
    case 'rides.pickup':
    case 'rides.board':
    case 'rides.cancel':
    case 'rides.withdraw':
      command = { type: name, id, expectedRevision };
      break;
    default:
      throw new ToolRefusal('unknown-mobility-command');
  }
  const decision = residentMobilityCommand({
    projection: state.world,
    actorId,
    command,
    requestId,
    simulationId: manifest.simulationId,
    nextSequence: state.worldSequence + 1,
  });
  if (!decision.accepted) throw new ToolRefusal(decision.reason);
  const after = applyOpenSocietyEffects(state, { worldEvents: decision.events }).world
    .residentMobility!;
  const data = name.startsWith('drivers.')
    ? after.drivers[actorId]
    : name.startsWith('vehicles.')
      ? after.vehicles[id]
      : name === 'rides.quote' || name === 'rides.withdraw'
        ? after.quotes[id]
        : after.rides[id];
  return { data, effects: { worldEvents: decision.events } };
}
export function mobilityInbox(state: OpenSocietyState, actorId: string) {
  const s = state.world.residentMobility;
  if (!s) return [];
  return Object.values(s.rides)
    .filter((r) => activeRide(r) && (r.riderId === actorId || r.driverId === actorId))
    .map((r) => ({
      kind:
        r.status === 'requested' &&
        Object.values(s.quotes).some(
          (q) => q.rideId === r.id && q.active && q.expiresAt > state.world.clock.now,
        )
          ? 'ride-quotes'
          : `ride-${r.status}`,
      id: r.id,
      at: r.at,
      dueAt: r.expiresAt,
      readWith: `town rides ${r.status === 'requested' ? 'quotes' : 'read'} --id ${r.id}`,
      section: r.status === 'requested' ? ('decisions' as const) : ('appointments' as const),
    }));
}

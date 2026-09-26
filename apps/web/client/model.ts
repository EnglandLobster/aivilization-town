/** Browser read models. They never decide or apply domain transitions. */
export type Row = Record<string, unknown>;
export const record = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
export const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(record) : []);
export const entries = (value: unknown): Row[] => Object.values(record(value)).map(record);
export const text = (value: unknown, fallback = '—'): string =>
  typeof value === 'string' && value ? value : fallback;
export const numeric = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const format = (value: unknown, digits = 0): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value)
    : '—';
export const words = (value: unknown): string =>
  text(value)
    .replaceAll('-', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
export type Point = { x: number; y: number };
export type Location = {
  locationId: string;
  name: string;
  kind: string;
  regionId: string;
  mapPosition: Point & { width: number; height: number };
  capacity: number | null;
  connections: Row[];
  activityAffinities: unknown[];
};
export type Citizen = {
  agentId: string;
  name: string;
  locationId: string;
  ownerPartitionKey: string;
  job: string;
  detail: Row;
};
export type Selection = { type: 'agent' | 'location'; id: string } | null;
export type View = 'map' | 'town' | 'market' | 'cognition' | 'overview' | 'steering';
export type Town = {
  locations: Record<string, Location>;
  agents: Record<string, Citizen>;
  transitByAgent: Row;
  calendar: Row;
  weather: Row;
  activityTimeByAgent: Row;
  townPulse: Row[];
  conversationRecords: Row[];
  regionalLandValues: unknown;
  clock: number;
  sequence: number;
  population: number;
};
export const emptyTown = (): Town => ({
  locations: {},
  agents: {},
  transitByAgent: {},
  calendar: {},
  weather: {},
  activityTimeByAgent: {},
  townPulse: [],
  conversationRecords: [],
  regionalLandValues: undefined,
  clock: 0,
  sequence: 0,
  population: 0,
});

export function readTown(envelope: Row, society: Row, directory: Row, partitionKey: string): Town {
  const projection = record(envelope.projection);
  const locations: Record<string, Location> = {};
  const sourceLocations = Array.isArray(society.locations)
    ? rows(society.locations).map((item) => record(item.location))
    : entries(projection.locations);
  for (const item of sourceLocations) {
    const position = record(item.mapPosition);
    if (
      typeof item.locationId !== 'string' ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    )
      continue;
    locations[item.locationId] = {
      locationId: item.locationId,
      name: text(item.name, item.locationId),
      kind: text(item.kind, 'place'),
      regionId: text(item.regionId, 'town'),
      mapPosition: {
        x: numeric(position.x),
        y: numeric(position.y),
        width: numeric(position.width, 0.1),
        height: numeric(position.height, 0.1),
      },
      capacity: typeof item.capacity === 'number' ? item.capacity : null,
      connections: rows(item.connections),
      activityAffinities: Array.isArray(item.activityAffinities) ? item.activityAffinities : [],
    };
  }
  const agents: Record<string, Citizen> = {};
  const transitByAgent: Row = {};
  const local = record(projection.agents);
  const cityAgents = Array.isArray(directory.agents)
    ? rows(directory.agents)
    : entries(local).map((item) => ({
        agentId: item.agentId,
        ownerPartitionKey: partitionKey,
        publicState: item,
      }));
  for (const item of cityAgents) {
    if (typeof item.agentId !== 'string') continue;
    const publicState = record(item.publicState);
    const detail =
      text(item.ownerPartitionKey, partitionKey) === partitionKey
        ? record(local[item.agentId])
        : {};
    const source = { ...detail, ...publicState };
    const transit = Array.isArray(directory.agents)
      ? publicState.transit
      : record(projection.transitByAgent)[item.agentId];
    if (transit) transitByAgent[item.agentId] = { ...record(transit), agentId: item.agentId };
    agents[item.agentId] = {
      agentId: item.agentId,
      name: text(
        record(source.registration).displayName,
        text(
          publicState.displayName,
          `Citizen ${item.agentId.match(/(\d+)$/)?.[1] ?? item.agentId}`,
        ),
      ),
      locationId: text(source.locationId, ''),
      job: text(source.job, 'Unassigned'),
      ownerPartitionKey: text(item.ownerPartitionKey, partitionKey),
      detail: source,
    };
  }
  return {
    locations,
    agents,
    transitByAgent,
    calendar: record(projection.calendar),
    weather: record(society.weather ?? projection.weather),
    activityTimeByAgent: record(projection.activityTimeByAgent),
    townPulse: rows(projection.townPulse),
    conversationRecords: rows(projection.conversationRecords),
    regionalLandValues: projection.regionalLandValues,
    clock: numeric(record(projection.clock).now),
    sequence: numeric(envelope.lastAppliedSequence),
    population: Object.keys(agents).length,
  };
}

/** Stable list ordering is also used for deterministic visual identity. */
export const citizenList = (town: Town): Citizen[] =>
  Object.values(town.agents).sort((a, b) => a.agentId.localeCompare(b.agentId));
export function activity(town: Town, citizen: Citizen): string {
  const transit = record(town.transitByAgent[citizen.agentId]);
  if (transit.toLocationId)
    return `Walking to ${town.locations[text(transit.toLocationId)]?.name ?? text(transit.toLocationId)}`;
  const current = record(town.activityTimeByAgent[citizen.agentId]);
  return current.activity && numeric(current.availableAt, Infinity) > town.clock
    ? words(current.activity)
    : 'At ' + (town.locations[citizen.locationId]?.name ?? 'home');
}

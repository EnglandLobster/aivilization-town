export type Waypoint = { x: number; y: number };
export type RoadNetwork = {
  edges: { key: string; fromId: string; toId: string; waypoints: Waypoint[] }[];
  waypointsByEdge: Map<string, Waypoint[]>;
};
export function computeRoadNetwork(locations: Record<string, unknown>): RoadNetwork;
export function aggregateEdgeFlows(
  transits: Record<string, unknown>,
): Map<string, { count: number; multiplier: number }>;
export function congestionLevel(flow: { count: number; multiplier: number } | undefined): number;

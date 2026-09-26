export type Point = { x: number; y: number };
export function hashAgentId(id: string): number;
export function resolveAgentPosition(
  agent: { agentId: string; locationId: string },
  world: {
    locations: Record<string, { mapPosition: Point & { width: number; height: number } }>;
    transitByAgent: Record<string, unknown>;
    roads?: unknown;
  },
  nowMs: number,
): (Point & { state: string; direction: string }) | null;

/**
 * Client-side movement synthesis for the living-town canvas.
 *
 * Honesty contract: agents have no continuous coordinates in any projection.
 * Everything here is a deterministic, replayable *visualization* of semantic
 * state — residents drift inside their location's authoritative `mapPosition`
 * rect (agentId-hash driven, no randomness), travelers move along the straight
 * segment between connection endpoints using the authoritative
 * `departedAt`/`arrivesAt` timestamps. The UI labels this as
 * "semantic layout · interpolated movement".
 *
 * Pure module: no DOM access, safe to import from tests.
 *
 * Rects are normalized (0-1) and center-based: `{x, y}` is the rect center,
 * matching the projection `mapPosition` contract in
 * `packages/content/src/locations.ts`.
 */

const TWO_PI = Math.PI * 2;
/** Keep drifting agents this far inside their location rect. */
const DRIFT_MARGIN = 0.02;
/** Resident wander period bounds, milliseconds of simulation/wall time. */
const DRIFT_PERIOD_MIN_MS = 9000;
const DRIFT_PERIOD_SPAN_MS = 7000;

/** Deterministic 32-bit hash (FNV-1a) so drift phases never depend on RNG. */
export function hashAgentId(agentId) {
  let hash = 0x811c9dc5;
  const text = String(agentId ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Deterministic in-rect drift for a resident agent. Returns normalized
 * coordinates inside `rect` plus the facing direction implied by horizontal
 * velocity.
 */
export function residentOffset(agentId, rect, timeMs) {
  const hash = hashAgentId(agentId);
  const halfWidth = Math.max(0, rect.width / 2 - DRIFT_MARGIN);
  const halfHeight = Math.max(0, rect.height / 2 - DRIFT_MARGIN);
  const periodX = DRIFT_PERIOD_MIN_MS + (hash % DRIFT_PERIOD_SPAN_MS);
  const periodY = DRIFT_PERIOD_MIN_MS + ((hash >>> 8) % DRIFT_PERIOD_SPAN_MS);
  const phaseX = ((hash >>> 16) % 1024) / 1024;
  const phaseY = ((hash >>> 4) % 1024) / 1024;
  const angleX = (timeMs / periodX + phaseX) * TWO_PI;
  const angleY = (timeMs / periodY + phaseY) * TWO_PI;
  return {
    x: rect.x + halfWidth * Math.sin(angleX),
    y: rect.y + halfHeight * Math.sin(angleY),
    direction: Math.cos(angleX) >= 0 ? 'right' : 'left',
  };
}

/**
 * Linear interpolation along the straight segment between two location
 * centers. `progress` is clamped to [0, 1]; at 1 the agent stands exactly on
 * the destination center.
 */
export function transitPosition(transit, fromRect, toRect, nowMs) {
  const departedAt = Number(transit?.departedAt);
  const arrivesAt = Number(transit?.arrivesAt);
  const duration = arrivesAt - departedAt;
  const progress =
    Number.isFinite(duration) && duration > 0
      ? clamp01((nowMs - departedAt) / duration)
      : nowMs >= arrivesAt
        ? 1
        : 0;
  const deltaX = toRect.x - fromRect.x;
  const deltaY = toRect.y - fromRect.y;
  return {
    x: fromRect.x + deltaX * progress,
    y: fromRect.y + deltaY * progress,
    progress,
    direction:
      Math.abs(deltaX) >= Math.abs(deltaY)
        ? deltaX >= 0
          ? 'right'
          : 'left'
        : deltaY >= 0
          ? 'down'
          : 'up',
  };
}

/**
 * Resolves where an agent should be drawn at `nowMs`.
 *
 * Returns `{ x, y, state, direction }` where state is `'transit'` (en route,
 * progress < 1) or `'resident'` (inside a location rect, including the moment
 * of arrival). Returns `null` when the projection gives no authoritative
 * placement (unknown location without `mapPosition`) — the renderer skips the
 * agent rather than inventing a position.
 */
export function resolveAgentPosition(agent, world, nowMs) {
  if (!agent?.agentId) return null;
  const locations = world?.locations || {};
  const transit = world?.transitByAgent?.[agent.agentId];
  const arrivesAt = Number(transit?.arrivesAt);
  if (transit && !(Number.isFinite(arrivesAt) && nowMs >= arrivesAt)) {
    const fromRect = locations[transit.fromLocationId]?.mapPosition;
    const toRect = locations[transit.toLocationId]?.mapPosition;
    if (fromRect && toRect) {
      return { ...transitPosition(transit, fromRect, toRect, nowMs), state: 'transit' };
    }
  }
  const locationId = transit ? transit.toLocationId : agent.locationId;
  const rect = locations[locationId]?.mapPosition;
  if (!rect) return null;
  return { ...residentOffset(agent.agentId, rect, nowMs), state: 'resident' };
}

/**
 * Click picking for the living-town canvas (pure functions).
 *
 * Works in normalized world coordinates (0-1, y down), the same space the
 * interpolation module emits. Agents are picked before buildings so a
 * walking agent standing "on" a building rect still wins the click.
 */

/** Distance from point to a center-based rect edge; 0 when inside. */
function rectDistance(point, rect) {
  const dx = Math.max(0, Math.abs(point.x - rect.x) - rect.width / 2);
  const dy = Math.max(0, Math.abs(point.y - rect.y) - rect.height / 2);
  return Math.hypot(dx, dy);
}

/**
 * `agentPositions` is an array of `{ agentId, x, y }` as resolved by
 * `resolveAgentPosition`. Returns the closest agent within `radius`, or null.
 */
export function pickAgent(point, agentPositions, radius) {
  let best = null;
  let bestDistance = radius;
  for (const agent of agentPositions) {
    const distance = Math.hypot(point.x - agent.x, point.y - agent.y);
    if (distance <= bestDistance) {
      best = agent;
      bestDistance = distance;
    }
  }
  return best ? { type: 'agent', id: best.agentId } : null;
}

/**
 * `locations` is an iterable of projection locations with `mapPosition`.
 * Returns the smallest rect containing the point, or the nearest rect within
 * `slack` (so small buildings stay clickable when zoomed out).
 */
export function pickLocation(point, locations, slack = 0.01) {
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const location of locations) {
    const rect = location?.mapPosition;
    if (!rect) continue;
    const distance = rectDistance(point, rect);
    if (distance > slack) continue;
    // Prefer the smaller rect when rects overlap, then the closer center.
    const score = distance * 10 + rect.width * rect.height;
    if (score < bestScore) {
      best = location;
      bestScore = score;
    }
  }
  return best ? { type: 'location', id: best.locationId } : null;
}

/** Combined picking: agents first, then buildings. Returns null on empty ground. */
export function pickEntity(point, { agentPositions = [], locations = [], agentRadius = 0.02 }) {
  return pickAgent(point, agentPositions, agentRadius) || pickLocation(point, locations);
}

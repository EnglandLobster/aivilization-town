/**
 * Road network geometry for the living-town canvas (pure module).
 *
 * The domain owns the *semantic* graph (location `connections` with travel
 * durations); this module synthesizes the pixel-town geometry on top of it:
 *
 * - Every connection renders as an orthogonal (elbow) road between the two
 *   building rect borders — deterministic elbow orientation keyed by the edge
 *   id, no randomness.
 * - The same waypoints drive traveler movement (see `interpolation.js`), so
 *   people visibly walk *along the roads* instead of beaming diagonally.
 * - Congestion comes only from authoritative transit data
 *   (`transitByAgent[].routeEdgeFlows` / active traversals); when the run
 *   carries no flow data the layer falls back to counting active transits per
 *   directed hop. Nothing here invents traffic.
 *
 * Honesty contract: waypoints are a deterministic *visualization* of the
 * authoritative connection graph — they never claim to be domain geometry.
 */

import { hashAgentId } from './interpolation.js';

/** Keep road elbows this far inside the normalized map. */
const MAP_MARGIN = 0.05;
/** Consecutive waypoints closer than this collapse into one (dedupe). */
const WAYPOINT_EPSILON = 0.005;

/** Canonical undirected edge key — stable regardless of traversal direction. */
export function edgeKey(fromId, toId) {
  return fromId <= toId ? `${fromId}::${toId}` : `${toId}::${fromId}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Point where the segment from `rect`'s center toward `toward` exits the rect
 * (slightly inset). Falls back to the center for degenerate directions.
 */
export function borderAnchor(rect, toward) {
  const dx = toward.x - rect.x;
  const dy = toward.y - rect.y;
  if (Math.hypot(dx, dy) < 1e-6) return { x: rect.x, y: rect.y };
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const scaleX = Math.abs(dx) > 1e-9 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = Math.abs(dy) > 1e-9 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(scaleX, scaleY) * 0.92;
  return { x: rect.x + dx * t, y: rect.y + dy * t };
}

/** Orthogonal elbow waypoints between two building rects for one edge key. */
export function elbowWaypoints(rectA, rectB, key) {
  const anchorA = borderAnchor(rectA, rectB);
  const anchorB = borderAnchor(rectB, rectA);
  const horizontalFirst = (hashAgentId(key) >>> 3) % 2 === 0;
  const elbow = horizontalFirst ? { x: anchorB.x, y: anchorA.y } : { x: anchorA.x, y: anchorB.y };
  const elbowClamped = {
    x: clamp(elbow.x, MAP_MARGIN, 1 - MAP_MARGIN),
    y: clamp(elbow.y, MAP_MARGIN, 1 - MAP_MARGIN),
  };
  const points = [anchorA];
  const elbowUseful = farEnough(anchorA, elbowClamped) && farEnough(elbowClamped, anchorB);
  if (elbowUseful) {
    points.push(elbowClamped);
  } else if (Math.abs(anchorA.x - anchorB.x) <= WAYPOINT_EPSILON) {
    // Near-vertical run whose elbow collapsed: snap to exact orthogonality.
    anchorA.x = anchorB.x;
  } else if (Math.abs(anchorA.y - anchorB.y) <= WAYPOINT_EPSILON) {
    anchorA.y = anchorB.y;
  }
  points.push(anchorB);
  return dedupe(points);
}

function farEnough(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) > WAYPOINT_EPSILON;
}

function dedupe(points) {
  const kept = [];
  for (const point of points) {
    if (!kept.length || farEnough(kept[kept.length - 1], point)) kept.push(point);
  }
  return kept.length >= 2 ? kept : [points[0], points[points.length - 1]];
}

/**
 * Builds the road network from projection `locations`. Returns
 * `{ edges: [{ key, fromId, toId, waypoints }], waypointsByEdge: Map }`.
 */
export function computeRoadNetwork(locations) {
  const placed = {};
  for (const location of Object.values(locations || {})) {
    if (location?.mapPosition) placed[location.locationId] = location;
  }
  const edges = [];
  const waypointsByEdge = new Map();
  const seen = new Set();
  for (const location of Object.values(placed)) {
    if (!Array.isArray(location.connections)) continue;
    for (const connection of location.connections) {
      const target = placed[connection.targetLocationId];
      if (!target) continue;
      const key = edgeKey(location.locationId, target.locationId);
      if (seen.has(key)) continue;
      seen.add(key);
      const waypoints = elbowWaypoints(location.mapPosition, target.mapPosition, key);
      waypointsByEdge.set(key, waypoints);
      edges.push({
        key,
        fromId: location.locationId,
        toId: target.locationId,
        waypoints,
      });
    }
  }
  return { edges, waypointsByEdge };
}

/** Location-id hops for a transit: authoritative multi-hop route or from→to. */
export function transitHops(transit) {
  const route = Array.isArray(transit?.routeLocationIds) ? transit.routeLocationIds : [];
  if (route.length >= 2) return [...route];
  if (transit?.fromLocationId && transit?.toLocationId) {
    return [transit.fromLocationId, transit.toLocationId];
  }
  return [];
}

/**
 * Full waypoint chain for one transit: every hop's road waypoints oriented in
 * travel direction and concatenated. Returns `null` when the transit has no
 * geometrically placed hops (the caller falls back to center-to-center).
 */
export function routeWaypointsForTransit(transit, locations, network) {
  const hops = transitHops(transit).filter((id) => locations?.[id]?.mapPosition);
  if (hops.length < 2) return null;
  const chain = [];
  for (let index = 0; index + 1 < hops.length; index += 1) {
    const fromId = hops[index];
    const toId = hops[index + 1];
    const fromRect = locations[fromId].mapPosition;
    const key = edgeKey(fromId, toId);
    let waypoints = network?.waypointsByEdge?.get(key);
    if (!waypoints) {
      waypoints = [{ ...fromRect }, { ...locations[toId].mapPosition }];
    }
    const oriented =
      Math.hypot(waypoints[0].x - fromRect.x, waypoints[0].y - fromRect.y) <=
      Math.hypot(
        waypoints[waypoints.length - 1].x - fromRect.x,
        waypoints[waypoints.length - 1].y - fromRect.y,
      )
        ? waypoints
        : [...waypoints].reverse();
    for (const point of oriented) {
      if (!chain.length || farEnough(chain[chain.length - 1], point)) chain.push(point);
    }
  }
  return chain.length >= 2 ? chain : null;
}

/** Position + facing at fraction `t` (0-1 over total length) along waypoints. */
export function positionAlongWaypoints(waypoints, t) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return null;
  const progress = Math.min(1, Math.max(0, t));
  const lengths = [0];
  let total = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    total += Math.hypot(
      waypoints[index].x - waypoints[index - 1].x,
      waypoints[index].y - waypoints[index - 1].y,
    );
    lengths.push(total);
  }
  if (total <= 0) return { ...waypoints[0], direction: 'down', progress: 1 };
  const target = progress * total;
  for (let index = 1; index < waypoints.length; index += 1) {
    if (target <= lengths[index] || index === waypoints.length - 1) {
      const span = lengths[index] - lengths[index - 1] || 1;
      const local = (target - lengths[index - 1]) / span;
      const a = waypoints[index - 1];
      const b = waypoints[index];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return {
        x: a.x + dx * local,
        y: a.y + dy * local,
        direction:
          Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up',
        progress,
      };
    }
  }
  return { ...waypoints[waypoints.length - 1], direction: 'down', progress: 1 };
}

/** Distance from a point to segment `a`→`b` (used for corridor avoidance). */
export function segmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/**
 * Aggregates authoritative traffic per undirected edge from the projection's
 * active transits. Prefers `routeEdgeFlows` (the authority's own per-edge
 * active-traversal counts); without it, each in-flight transit contributes one
 * traversal per directed hop. Returns `Map(edgeKey → { count, multiplier })`.
 */
export function aggregateEdgeFlows(transitByAgent) {
  const flows = new Map();
  const bump = (key, count, multiplier) => {
    const existing = flows.get(key) || { count: 0, multiplier: 1 };
    existing.count += count;
    existing.multiplier = Math.max(existing.multiplier, multiplier || 1);
    flows.set(key, existing);
  };
  for (const transit of Object.values(transitByAgent || {})) {
    if (!transit) continue;
    if (Array.isArray(transit.routeEdgeFlows) && transit.routeEdgeFlows.length > 0) {
      for (const flow of transit.routeEdgeFlows) {
        if (!flow?.fromLocationId || !flow?.toLocationId) continue;
        bump(
          edgeKey(flow.fromLocationId, flow.toLocationId),
          Math.max(1, Number(flow.activeTraversalCount) || 1),
          Number(flow.congestionMultiplier) || 1,
        );
      }
      continue;
    }
    const hops = transitHops(transit);
    const multiplier = Number(transit.congestionMultiplier) || 1;
    for (let index = 0; index + 1 < hops.length; index += 1) {
      bump(edgeKey(hops[index], hops[index + 1]), 1, multiplier);
    }
  }
  return flows;
}

/** Normalized congestion 0-1 for one edge flow (green → amber → red). */
export function congestionLevel(flow) {
  if (!flow) return 0;
  const byCount = Math.min(1, Math.max(0, (flow.count - 1) / 6));
  const byMultiplier = Math.min(1, Math.max(0, (flow.multiplier - 1) / 1.5));
  return Math.max(byCount, byMultiplier);
}

/** Traffic heat color for a congestion level (alpha scales with intensity). */
export function congestionColor(level) {
  const clamped = Math.min(1, Math.max(0, level));
  if (clamped < 0.5) {
    const t = clamped / 0.5;
    return `rgba(${Math.round(120 + t * 100)}, ${Math.round(150 - t * 40)}, 70, ${(0.25 + clamped * 0.5).toFixed(2)})`;
  }
  const t = (clamped - 0.5) / 0.5;
  return `rgba(${Math.round(220 + t * 20)}, ${Math.round(110 - t * 55)}, ${Math.round(70 - t * 35)}, ${(0.5 + t * 0.35).toFixed(2)})`;
}

/**
 * Deterministic pixel-town scenery (pure module).
 *
 * Everything here is *decoration of authoritative layout*: trees, bushes,
 * rocks and lampposts are placed by a deterministic hash over the normalized
 * map grid, avoiding building rects and road corridors computed by
 * `roads.js`. The maritime water band is derived from region ids (a region
 * named e.g. "harbor" earns a shoreline on its nearest map edge); regional
 * ground tones tint each region's bounding box by the authoritative
 * `regionalLandValues` slice. No scenery claims to be domain state.
 */

import { hashAgentId } from './interpolation.js';
import { computeRoadNetwork, segmentDistance } from './roads.js';

/** Candidate scenery cells per map axis. */
export const SCENERY_GRID = 20;
/** Keep scenery this far away from building footprints. */
const BUILDING_MARGIN = 0.015;
/** Half-width of the no-scenery corridor around roads. */
const ROAD_CLEARANCE = 0.028;
/** Keep scenery this far from the map border. */
const BORDER_MARGIN = 0.03;

const SCENERY_TABLE = [
  { type: 'flower', weight: 22 },
  { type: 'bush', weight: 16 },
  { type: 'rock', weight: 9 },
  { type: 'tree', weight: 21 },
  { type: 'none', weight: 32 },
];

const SCENERY_TOTAL_WEIGHT = SCENERY_TABLE.reduce((sum, entry) => sum + entry.weight, 0);

function sceneryTypeFor(hash) {
  let cursor = hash % SCENERY_TOTAL_WEIGHT;
  for (const entry of SCENERY_TABLE) {
    if (cursor < entry.weight) return entry.type;
    cursor -= entry.weight;
  }
  return 'none';
}

function insideRect(point, rect, margin = 0) {
  return (
    Math.abs(point.x - rect.x) <= rect.width / 2 + margin &&
    Math.abs(point.y - rect.y) <= rect.height / 2 + margin
  );
}

/** Accepts bare rects and `{ rect }` wrappers (water regions use the latter). */
function insideAnyRect(point, rects, margin = 0) {
  return rects.some((entry) => {
    const rect = entry?.rect ?? entry;
    return rect && insideRect(point, rect, margin);
  });
}

function nearAnyRoad(point, edges, clearance) {
  for (const edge of edges) {
    for (let index = 1; index < edge.waypoints.length; index += 1) {
      if (
        segmentDistance(point, edge.waypoints[index - 1], edge.waypoints[index]) <= clearance
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Computes the deterministic scenery layout. Returns
 * `{ items: [{ type, x, y, scale, tone }], lampposts: [{ x, y }] }`.
 * `waterRects` should be the output of `computeWaterRegions` — scenery and
 * lampposts never spawn inside buildings, water or road corridors.
 */
export function computeScenery(locations, network, waterRects = []) {
  const locationList = Object.values(locations || {}).filter((location) => location?.mapPosition);
  const buildingRects = locationList.map((location) => location.mapPosition);
  const edges = network?.edges ?? computeRoadNetwork(locations).edges;
  const plazaRects = locationList
    .filter((location) => location.locationId === 'town-square')
    .map((location) => location.mapPosition);

  const items = [];
  for (let row = 0; row < SCENERY_GRID; row += 1) {
    for (let col = 0; col < SCENERY_GRID; col += 1) {
      const hash = hashAgentId(`scenery:${row}:${col}`);
      const type = sceneryTypeFor(hash);
      if (type === 'none') continue;
      const cell = 1 / SCENERY_GRID;
      const point = {
        x: (col + 0.15 + ((hash >>> 4) % 70) / 100) * cell,
        y: (row + 0.15 + ((hash >>> 9) % 70) / 100) * cell,
      };
      if (
        point.x < BORDER_MARGIN ||
        point.x > 1 - BORDER_MARGIN ||
        point.y < BORDER_MARGIN ||
        point.y > 1 - BORDER_MARGIN
      ) {
        continue;
      }
      if (insideAnyRect(point, buildingRects, BUILDING_MARGIN)) continue;
      if (insideAnyRect(point, plazaRects, BUILDING_MARGIN)) continue;
      if (insideAnyRect(point, waterRects, 0.01)) continue;
      if (nearAnyRoad(point, edges, ROAD_CLEARANCE)) continue;
      items.push({
        type,
        x: point.x,
        y: point.y,
        scale: 0.8 + ((hash >>> 14) % 40) / 100,
        tone: (hash >>> 6) % 3,
      });
    }
  }

  const lampposts = [];
  for (const edge of edges) {
    const candidates = [];
    const { waypoints } = edge;
    for (let index = 1; index < waypoints.length; index += 1) {
      const a = waypoints[index - 1];
      const b = waypoints[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length > 0.16) {
        candidates.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      if (index === waypoints.length - 1 && waypoints.length > 2) {
        candidates.push({ ...b });
      }
    }
    for (const candidate of candidates) {
      if (insideAnyRect(candidate, buildingRects, BUILDING_MARGIN)) continue;
      if (insideAnyRect(candidate, waterRects, 0.01)) continue;
      lampposts.push(candidate);
    }
  }

  return { items, lampposts };
}

const MARITIME_REGION_PATTERN = /harbor|harbour|port|coast|bay|seaside|dock/i;

/**
 * Water bands for maritime regions: each region whose id looks maritime gets a
 * shoreline along the map edge nearest to its bounding box. Returns
 * `[{ regionId, rect }]` in normalized coordinates (`rect` is center-based).
 */
export function computeWaterRegions(locations) {
  const locationList = Object.values(locations || {}).filter((location) => location?.mapPosition);
  const allRects = locationList.map((location) => location.mapPosition);
  const byRegion = new Map();
  for (const location of locationList) {
    if (!location.regionId || !MARITIME_REGION_PATTERN.test(location.regionId)) continue;
    const rect = location.mapPosition;
    const bounds = byRegion.get(location.regionId) || { minX: 1, minY: 1, maxX: 0, maxY: 0 };
    bounds.minX = Math.min(bounds.minX, rect.x - rect.width / 2);
    bounds.minY = Math.min(bounds.minY, rect.y - rect.height / 2);
    bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width / 2);
    bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height / 2);
    byRegion.set(location.regionId, bounds);
  }

  const MIN_BAND = 0.05;
  const regions = [];
  for (const [regionId, bounds] of byRegion) {
    // Shore hugs the closest edge that still leaves room for a visible band.
    const candidates = [
      { edge: 'right', gap: 1 - bounds.maxX },
      { edge: 'bottom', gap: 1 - bounds.maxY },
      { edge: 'left', gap: bounds.minX },
      { edge: 'top', gap: bounds.minY },
    ]
      .filter((candidate) => candidate.gap >= 0.07)
      .sort((a, b) => a.gap - b.gap);
    if (candidates.length === 0) continue;
    const { edge } = candidates[0];
    let near;
    let far;
    let spanLo;
    let spanHi;
    if (edge === 'bottom' || edge === 'top') {
      spanLo = bounds.minX - 0.18;
      spanHi = bounds.maxX + 0.18;
      const occupied = Math.max(
        ...(edge === 'bottom'
          ? allRects.map((rect) => rect.y + rect.height / 2)
          : allRects.map((rect) => rect.y - rect.height / 2).map((value) => -value)),
      );
      near = edge === 'bottom' ? Math.max(bounds.maxY + 0.025, occupied + 0.02) : Math.min(bounds.minY - 0.025, -occupied - 0.02);
      far = edge === 'bottom' ? 1 : 0;
    } else {
      spanLo = bounds.minY - 0.18;
      spanHi = bounds.maxY + 0.18;
      const occupied = Math.max(
        ...(edge === 'right'
          ? allRects.map((rect) => rect.x + rect.width / 2)
          : allRects.map((rect) => rect.x - rect.width / 2).map((value) => -value)),
      );
      near = edge === 'right' ? Math.max(bounds.maxX + 0.025, occupied + 0.02) : Math.min(bounds.minX - 0.025, -occupied - 0.02);
      far = edge === 'right' ? 1 : 0;
    }
    if (Math.abs(far - near) < MIN_BAND) continue;
    regions.push({
      regionId,
      rect: {
        x: (Math.max(0, spanLo) + Math.min(1, spanHi)) / 2,
        y: (near + far) / 2,
        width: Math.min(1, spanHi) - Math.max(0, spanLo),
        height: Math.abs(far - near),
      },
    });
  }
  return regions;
}

/**
 * Ground tone per region derived from authoritative `regionalLandValues`:
 * higher relative land value earns a warmer, richer ground tint. Returns
 * `Map(regionId → { alpha })`; empty when the slice is absent (flag-gated).
 */
export function regionGroundTones(locations, regionalLandValues) {
  const tones = new Map();
  if (!regionalLandValues) return tones;
  const values = Object.values(regionalLandValues);
  if (values.length === 0) return tones;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const hasRegions = Object.values(locations || {}).some((location) => location?.regionId);
  if (!hasRegions) return tones;
  for (const [regionId, value] of Object.entries(regionalLandValues)) {
    const normalized = max > min ? (Number(value) - min) / (max - min) : 0.5;
    tones.set(regionId, { alpha: 0.05 + normalized * 0.08, normalized });
  }
  return tones;
}

/** Display label for a region id ("harbor" → "Harbor", "old-town" → "Old Town"). */
export function regionLabel(regionId) {
  return String(regionId || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Bounding boxes of all regions present on the map (for ground tints and
 * labels). Returns `[{ regionId, rect }]`.
 */
export function regionBounds(locations) {
  const byRegion = new Map();
  for (const location of Object.values(locations || {})) {
    if (!location?.mapPosition || !location.regionId) continue;
    const rect = location.mapPosition;
    const bounds = byRegion.get(location.regionId) || { minX: 1, minY: 1, maxX: 0, maxY: 0 };
    bounds.minX = Math.min(bounds.minX, rect.x - rect.width / 2);
    bounds.minY = Math.min(bounds.minY, rect.y - rect.height / 2);
    bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width / 2);
    bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height / 2);
    byRegion.set(location.regionId, bounds);
  }
  return [...byRegion.entries()].map(([regionId, bounds]) => ({
    regionId,
    rect: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    },
  }));
}

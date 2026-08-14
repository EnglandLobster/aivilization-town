/**
 * Tilesheet loading and sprite index for the living-town canvas.
 *
 * The layout constants mirror `tools/generate-tilesheet.mjs`; keep both in
 * sync if the sheet layout changes. Sprites are 16×16 px tiles on a 256×256
 * sheet; buildings are 2×2-tile blocks indexed by location kind and upgrade
 * level (levels 2-3 are placeholders reserved for spatial growth, #8).
 */

export const TILE_SIZE = 16;
export const TILESHEET_URL = '/ui/assets/tiles.png';

const TERRAIN_ROW = 0;
const BUILDING_FIRST_ROW = 1;
const BUILDING_ROWS = 2;
const AGENT_ROW = 15;

const BUILDING_ROWS_BY_LOCATION = {
  'town-square': 0,
  'residential-block': 1,
  school: 2,
  clinic: 3,
  restaurant: 4,
  market: 5,
  workshop: 6,
};

const AGENT_DIR_COLUMNS = { down: 0, up: 2, left: 4, right: 6 };

export const TERRAIN_TILES = {
  // Weighted toward plain grass: the flowered variant (col 2) reads as noise
  // when it covers a third of the map.
  grass: [0, 0, 1, 0, 2].map((col) => ({ col, row: TERRAIN_ROW })),
  path: [3, 4].map((col) => ({ col, row: TERRAIN_ROW })),
  plaza: [5, 6].map((col) => ({ col, row: TERRAIN_ROW })),
};

export const SELECTION_TILE = { col: 8, row: AGENT_ROW };

/** Rect in sheet pixels for a single tile. */
export function tileRect(tile) {
  return {
    sx: tile.col * TILE_SIZE,
    sy: tile.row * TILE_SIZE,
    sw: TILE_SIZE,
    sh: TILE_SIZE,
  };
}

/** Rect in sheet pixels for a building sprite (2×2 tiles). Level is clamped to 1-3. */
export function buildingRect(locationId, level = 1) {
  const band = BUILDING_ROWS_BY_LOCATION[locationId] ?? 0;
  const clampedLevel = Math.min(3, Math.max(1, Math.round(level) || 1));
  return {
    sx: (clampedLevel - 1) * 2 * TILE_SIZE,
    sy: (BUILDING_FIRST_ROW + band * BUILDING_ROWS) * TILE_SIZE,
    sw: TILE_SIZE * 2,
    sh: TILE_SIZE * 2,
  };
}

/** Rect in sheet pixels for an agent walk frame. */
export function agentRect(direction, frame) {
  const col = (AGENT_DIR_COLUMNS[direction] ?? 0) + (frame ? 1 : 0);
  return { sx: col * TILE_SIZE, sy: AGENT_ROW * TILE_SIZE, sw: TILE_SIZE, sh: TILE_SIZE };
}

/** Loads the sheet image; resolves with `null` (instead of throwing) on failure. */
export function loadTilesheet(url = TILESHEET_URL) {
  return new Promise((resolvePromise) => {
    const image = new Image();
    image.onload = () => resolvePromise(image);
    image.onerror = () => resolvePromise(null);
    image.src = url;
  });
}

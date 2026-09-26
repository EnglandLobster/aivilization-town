#!/usr/bin/env node
/**
 * Archived placeholder tilesheet generator for the former Canvas renderer.
 *
 * Status: this is the FALLBACK generator. The canonical
 * `public/ui/assets/tiles.png` is the Kenney Tiny Town (CC0) repack produced
 * by `tools/repack-kenney-tilesheet.py`; only the agent walk sprites and the
 * selection bracket on the last row still come from this script. Re-run it
 * only to regenerate placeholder art or those row-15 sprites — running it
 * overwrites the whole sheet.
 *
 * This asset tool has no runtime dependencies: pixels are drawn into an RGBA buffer and encoded as PNG with a
 * minimal hand-rolled encoder (raw scanlines, filter byte 0, zlib deflate via
 * node:zlib). Artists can replace `public/ui/assets/tiles.png` with a drawn
 * sheet as long as the tile layout below is preserved.
 *
 * Layout (16 px tiles, 16 × 16 grid = 256 × 256 px):
 *   row 0       terrain: grass ×3, path ×2, plaza ×2
 *   rows 1-14   buildings: one location kind per 2-row band, 3 upgrade levels
 *               side by side, each sprite 2×2 tiles (32 × 32 px)
 *   row 15      agent walk sprites (4 directions × 2 frames), selection
 *               bracket, agent marker shadow
 *
 * Historical Canvas renderer asset layout; the current Pixi renderer uses procedural art.
 *
 * Usage: node apps/web/tools/generate-tilesheet.mjs [outputPath]
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 16;
const SHEET_TILES = 16;
const WIDTH = TILE * SHEET_TILES;
const HEIGHT = TILE * SHEET_TILES;

const TERRAIN_ROW = 0;
const BUILDING_FIRST_ROW = 1;
const BUILDING_ROWS = 2;
const BUILDING_LEVELS = 3;
const AGENT_ROW = 15;
const SELECTION_TILE = [8, AGENT_ROW];

const BUILDING_ORDER = [
  'town-square',
  'residential-block',
  'school',
  'clinic',
  'restaurant',
  'market',
  'workshop',
];

// ---------------------------------------------------------------------------
// Pixel buffer helpers
// ---------------------------------------------------------------------------

const pixels = new Uint8Array(WIDTH * HEIGHT * 4); // transparent black

function setPx(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

function fillRect(x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPx(col, row, color);
    }
  }
}

function fillTile(tileX, tileY, color) {
  fillRect(tileX * TILE, tileY * TILE, TILE, TILE, color);
}

/** Deterministic value noise so terrain variants are stable between runs. */
function noise(x, y, seed) {
  let hash = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function shade([r, g, b, a = 255], amount) {
  return [
    Math.max(0, Math.min(255, r + amount)),
    Math.max(0, Math.min(255, g + amount)),
    Math.max(0, Math.min(255, b + amount)),
    a,
  ];
}

function drawTerrainTile(tileX, base, speckle, seed) {
  fillTile(tileX, TERRAIN_ROW, base);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const value = noise(tileX * TILE + x, y, seed);
      if (value > 0.82) setPx(tileX * TILE + x, TERRAIN_ROW * TILE + y, shade(base, 14));
      else if (value < 0.12) setPx(tileX * TILE + x, TERRAIN_ROW * TILE + y, speckle);
    }
  }
}

function drawTerrain() {
  const grass = [86, 138, 84];
  drawTerrainTile(0, grass, shade(grass, -18), 11);
  drawTerrainTile(1, shade(grass, 8), shade(grass, -12), 23);
  drawTerrainTile(2, shade(grass, -6), shade(grass, -24), 37);
  const path = [156, 133, 96];
  drawTerrainTile(3, path, shade(path, -22), 41);
  drawTerrainTile(4, shade(path, 10), shade(path, -14), 53);
  const plaza = [150, 152, 146];
  drawTerrainTile(5, plaza, shade(plaza, -20), 61);
  drawTerrainTile(6, shade(plaza, 8), shade(plaza, -12), 67);
  // Paving seams so plaza/path read as laid stone.
  for (const tileX of [3, 4, 5, 6]) {
    for (let i = 0; i < TILE; i += 1) {
      setPx(tileX * TILE + i, TERRAIN_ROW * TILE, shade(plaza, -32));
      setPx(tileX * TILE, TERRAIN_ROW * TILE + i, shade(plaza, -32));
    }
  }
}

// ---------------------------------------------------------------------------
// Buildings (2×2 tiles per sprite, 3 upgrade levels per kind)
// ---------------------------------------------------------------------------

const PALETTES = {
  'town-square': { wall: [196, 188, 170], roof: [120, 118, 112], trim: [94, 96, 92] },
  'residential-block': { wall: [204, 156, 110], roof: [146, 74, 58], trim: [118, 62, 50] },
  school: { wall: [198, 170, 120], roof: [96, 110, 150], trim: [70, 82, 118] },
  clinic: { wall: [214, 214, 208], roof: [112, 148, 138], trim: [158, 72, 62] },
  restaurant: { wall: [206, 140, 96], roof: [168, 84, 52], trim: [236, 220, 188] },
  market: { wall: [172, 146, 104], roof: [188, 60, 52], trim: [240, 234, 220] },
  workshop: { wall: [140, 138, 132], roof: [92, 96, 102], trim: [66, 68, 72] },
};

function drawWindows(originX, originY, width, rows, cols, glass) {
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = originX + 3 + col * Math.floor((width - 6) / Math.max(1, cols - 1) || width);
      const y = originY + 3 + row * 6;
      fillRect(x, y, 2, 3, glass);
    }
  }
}

/**
 * Draws one building sprite. `level` (1-3) raises the silhouette and adds
 * structure so the canvas can swap frames once spatial growth (#8) lands.
 */
function drawBuilding(kind, level, originX, originY) {
  const palette = PALETTES[kind];
  const glass = [178, 214, 224];
  const door = [88, 64, 48];
  // Sprite canvas is 32×32; buildings sit on the bottom edge.
  const groundY = originY + 31;
  const bodyWidth = 18 + level * 3;
  const bodyHeight = 10 + level * 4;
  const left = originX + Math.floor((32 - bodyWidth) / 2);
  const top = groundY - bodyHeight;

  if (kind === 'town-square') {
    // Fountain plaza: basin, water, tiered spout growing per level.
    fillRect(left - 2, groundY - 4, bodyWidth + 4, 4, palette.trim);
    fillRect(left, groundY - 6, bodyWidth, 3, [104, 156, 196]);
    fillRect(left - 2, groundY - 7, bodyWidth + 4, 2, palette.wall);
    const centerX = originX + 16;
    fillRect(centerX - 2, groundY - 12 - level * 2, 4, 6 + level * 2, palette.wall);
    fillRect(centerX - 4, groundY - 13 - level * 2, 8, 2, palette.roof);
    fillRect(centerX - 1, groundY - 16 - level * 2, 2, 3, [140, 190, 220]);
    return;
  }

  // Generic body.
  fillRect(left, top, bodyWidth, bodyHeight, palette.wall);
  fillRect(left, top, bodyWidth, 1, shade(palette.wall, 22));

  if (kind === 'market') {
    // Stall stripes.
    for (let col = 0; col < bodyWidth; col += 4) {
      fillRect(left + col, top, 2, 4, palette.roof);
      fillRect(left + col + 2, top, 2, 4, palette.trim);
    }
    fillRect(left, top + 4, bodyWidth, 1, palette.trim);
  } else if (kind === 'workshop') {
    // Sawtooth roof plus a chimney that grows with level.
    for (let col = 0; col < bodyWidth; col += 6) {
      fillRect(left + col, top - 3, 3, 3, palette.roof);
      fillRect(left + col + 3, top - 1, 3, 1, palette.roof);
    }
    fillRect(left + bodyWidth - 4, top - 5 - level, 3, 5 + level, palette.trim);
    fillRect(left + bodyWidth - 5, top - 6 - level, 5, 1, shade(palette.trim, 20));
  } else {
    // Pitched roof; level 2+ adds a second tier, level 3 a ridge cap.
    for (let step = 0; step < 4 + level; step += 1) {
      fillRect(left - 1 + step, top - 1 - step, bodyWidth + 2 - step * 2, 1, palette.roof);
    }
    if (level >= 2) fillRect(left + 2, top - 6 - level, bodyWidth - 4, 1, palette.trim);
  }

  drawWindows(left, top + 3, bodyWidth, level >= 3 ? 2 : 1, Math.max(2, level + 1), glass);

  // Kind-specific emblem.
  if (kind === 'clinic') {
    fillRect(left + Math.floor(bodyWidth / 2) - 1, top + 2, 2, 6, palette.trim);
    fillRect(left + Math.floor(bodyWidth / 2) - 3, top + 4, 6, 2, palette.trim);
  } else if (kind === 'school' && level >= 2) {
    const poleX = left + bodyWidth - 3;
    fillRect(poleX, top - 10, 1, 10, palette.trim);
    fillRect(poleX + 1, top - 10, 4, 3, [206, 74, 60]);
  } else if (kind === 'restaurant') {
    // Awning over the door.
    for (let col = 0; col < 8; col += 2) {
      fillRect(left + Math.floor(bodyWidth / 2) - 4 + col, groundY - 9, 1, 2, palette.trim);
      fillRect(left + Math.floor(bodyWidth / 2) - 3 + col, groundY - 9, 1, 2, palette.roof);
    }
  }

  // Door, centered on the ground line.
  fillRect(left + Math.floor(bodyWidth / 2) - 2, groundY - 6, 4, 6, door);
  setPx(left + Math.floor(bodyWidth / 2) + 1, groundY - 3, shade(door, 40));
}

function drawBuildings() {
  BUILDING_ORDER.forEach((kind, index) => {
    const row = BUILDING_FIRST_ROW + index * BUILDING_ROWS;
    for (let level = 1; level <= BUILDING_LEVELS; level += 1) {
      drawBuilding(kind, level, (level - 1) * 2 * TILE, row * TILE);
    }
  });
}

// ---------------------------------------------------------------------------
// Agents (4 directions × 2 frames), selection bracket
// ---------------------------------------------------------------------------

const AGENT_DIRS = ['down', 'up', 'left', 'right'];

function drawAgent(direction, frame, tileX) {
  const originX = tileX * TILE;
  const originY = AGENT_ROW * TILE;
  const skin = [224, 184, 148];
  const hair = [74, 56, 44];
  const shirt = [86, 112, 158];
  const pants = [64, 66, 78];
  const bob = frame === 1 ? 1 : 0;

  // Legs alternate between frames to read as walking.
  fillRect(originX + 5, originY + 11, 2, 4 - bob, pants);
  fillRect(originX + 9, originY + 11, 2, 3 + bob, pants);
  // Body.
  fillRect(originX + 4, originY + 6, 8, 6, shirt);
  // Head.
  fillRect(originX + 5, originY + 1, 6, 5, skin);
  if (direction === 'up') {
    fillRect(originX + 5, originY + 1, 6, 4, hair);
  } else {
    fillRect(originX + 5, originY + 1, 6, 2, hair);
    const eyeY = originY + 3;
    if (direction === 'down') {
      setPx(originX + 6, eyeY, hair);
      setPx(originX + 9, eyeY, hair);
    } else if (direction === 'left') {
      fillRect(originX + 4, originY + 2, 1, 5, shirt);
      setPx(originX + 6, eyeY, hair);
      fillRect(originX + 9, originY + 1, 2, 5, hair);
    } else {
      fillRect(originX + 11, originY + 2, 1, 5, shirt);
      setPx(originX + 9, eyeY, hair);
      fillRect(originX + 5, originY + 1, 2, 5, hair);
    }
  }
}

function drawAgents() {
  AGENT_DIRS.forEach((direction, index) => {
    drawAgent(direction, 0, index * 2);
    drawAgent(direction, 1, index * 2 + 1);
  });
}

function drawSelection() {
  const [tileX, tileY] = SELECTION_TILE;
  const originX = tileX * TILE;
  const originY = tileY * TILE;
  const color = [250, 240, 160];
  for (let i = 0; i < 5; i += 1) {
    setPx(originX + i, originY, color);
    setPx(originX, originY + i, color);
    setPx(originX + TILE - 1 - i, originY, color);
    setPx(originX + TILE - 1, originY + i, color);
    setPx(originX + i, originY + TILE - 1, color);
    setPx(originX, originY + TILE - 1 - i, color);
    setPx(originX + TILE - 1 - i, originY + TILE - 1, color);
    setPx(originX + TILE - 1, originY + TILE - 1 - i, color);
  }
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (truecolor RGBA, no interlace, filter type 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression 0, filter 0, interlace 0 are already zeroed.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

drawTerrain();
drawBuildings();
drawAgents();
drawSelection();

const defaultOutput = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/ui/assets/tiles.png',
);
const output = resolve(process.argv[2] ?? defaultOutput);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, encodePng(pixels, WIDTH, HEIGHT));
console.log(`tilesheet written: ${output} (${WIDTH}x${HEIGHT}px)`);

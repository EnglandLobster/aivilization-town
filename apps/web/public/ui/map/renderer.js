/**
 * Canvas renderer for the living-town map.
 *
 * Layer pipeline per frame:
 *   static bake (terrain · region tints · water · plaza · roads · scenery ·
 *   lampposts) → water shimmer → traffic heat on roads → buildings (sprites,
 *   labels, night windows, chimney smoke) → agents (road-following walk,
 *   palettes, activity bubbles, condition markers) → conversation links →
 *   lamp glows → ambient wildlife → town-pulse ticker → weather → day/night
 *   tint → selection.
 *
 * The camera supports drag pan and wheel zoom (clamped). The rAF loop only
 * runs while the tab is visible.
 *
 * All geometry lives in normalized world coordinates (0-1, y down) matching
 * the projection `mapPosition` contract. Agent movement is client-side
 * interpolation (see `interpolation.js` + `roads.js`) — the canvas never
 * claims real coordinates. Scenery, water and lampposts are deterministic
 * decoration (see `decor.js`); traffic heat, weather, calendar, activities,
 * conversations and the news ticker come exclusively from projection slices
 * and render nothing when those flag-gated fields are absent.
 */
import {
  TERRAIN_TILES,
  SELECTION_TILE,
  agentRect,
  buildingRect,
  loadTilesheet,
  tileRect,
} from './tilesheet.js';
import { hashAgentId, resolveAgentPosition } from './interpolation.js';
import { createWeatherLayer } from './weatherLayer.js';
import { pickEntity } from './picking.js';
import {
  aggregateEdgeFlows,
  computeRoadNetwork,
  congestionColor,
  congestionLevel,
  positionAlongWaypoints,
} from './roads.js';
import {
  computeScenery,
  computeWaterRegions,
  regionBounds,
  regionGroundTones,
  regionLabel,
} from './decor.js';
import { daytimeOverlays, isNightlightTime, resolveDaytime } from './dayNight.js';
import {
  computeActivityBubbles,
  computeConversationLinks,
  computePulseTicker,
  describePulseRecord,
} from './ambient.js';

const TERRAIN_GRID = 28; // terrain tiles per world axis
const TERRAIN_BITMAP_PX = 1120; // offscreen resolution for the static bake
const AGENT_RADIUS_WORLD = 0.02;
const AGENT_SIZE_WORLD = 0.026;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 5;
const ROAD_WIDTH_WORLD = 0.012;
const LABEL_COLOR = '#23302a';
const LABEL_PLATE = 'rgba(251, 250, 246, 0.85)';
const MARKER_COLORS = { condition: '#946720', conflict: '#a44d38' };
const AGENT_PALETTE = [
  '#c0504d',
  '#4f81bd',
  '#8064a2',
  '#4bacc6',
  '#d1863f',
  '#d16b86',
  '#5f8a3d',
  '#8a6db0',
];
const TREE_CANOPIES = ['#3f7a46', '#4c8a4f', '#35693f'];
const FLOWER_COLORS = ['#e2c04a', '#d5779a', '#eef0f4'];
const SMOKE_KINDS = new Set(['production', 'food']);
const QUIET_WEATHER = new Set(['sunny', 'cloudy', 'windy', 'foggy']);

export function createMapRenderer({ canvas, getNow, onSelect }) {
  const ctx = canvas.getContext('2d');
  const weather = createWeatherLayer();
  const camera = { x: 0.5, y: 0.5, zoom: 1 };
  let tilesheet = null;
  let world = emptyWorld();
  let network = computeRoadNetwork(world.locations);
  let selection = null;
  let frameHandle = 0;
  let running = false;
  let layoutDirty = true;
  let viewWidth = 0;
  let viewHeight = 0;
  let drag = null;
  let terrainCanvas = null;
  // Static-layout caches computed during rebuilds, shared by dynamic passes.
  let scenery = { items: [], lampposts: [] };
  let waterRects = [];
  // Per-frame caches shared between draw passes.
  let occupancyByLocation = {};
  let agentScreensById = new Map();

  const now = () => (typeof getNow === 'function' ? getNow() : Date.now());

  loadTilesheet().then((image) => {
    tilesheet = image;
    layoutDirty = true;
  });

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  resize();

  document.addEventListener('visibilitychange', handleVisibility);
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  start();

  function emptyWorld() {
    return { locations: {}, agents: {}, transitByAgent: {}, markersByAgent: {} };
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    viewWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 640;
    viewHeight = canvas.clientHeight || canvas.parentElement?.clientHeight || 480;
    canvas.width = Math.round(viewWidth * ratio);
    canvas.height = Math.round(viewHeight * ratio);
  }

  function handleVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    frameHandle = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }

  // -- coordinate transforms -------------------------------------------------

  function worldScale() {
    return Math.min(viewWidth, viewHeight) * camera.zoom;
  }

  function worldToScreen(point) {
    const scale = worldScale();
    return {
      x: (point.x - camera.x) * scale + viewWidth / 2,
      y: (point.y - camera.y) * scale + viewHeight / 2,
    };
  }

  function screenToWorld(point) {
    const scale = worldScale();
    return {
      x: (point.x - viewWidth / 2) / scale + camera.x,
      y: (point.y - viewHeight / 2) / scale + camera.y,
    };
  }

  function clampCamera() {
    camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
    // Allow some slack so edge buildings stay reachable at high zoom.
    const slack = 0.25 / camera.zoom;
    camera.x = Math.min(1 + slack, Math.max(-slack, camera.x));
    camera.y = Math.min(1 + slack, Math.max(-slack, camera.y));
  }

  // -- input -----------------------------------------------------------------

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handlePointerDown(event) {
    canvas.setPointerCapture(event.pointerId);
    drag = { start: canvasPoint(event), cameraX: camera.x, cameraY: camera.y, moved: false };
  }

  function handlePointerMove(event) {
    if (!drag) return;
    const point = canvasPoint(event);
    const scale = worldScale();
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      camera.x = drag.cameraX - dx / scale;
      camera.y = drag.cameraY - dy / scale;
      clampCamera();
    }
  }

  function handlePointerUp(event) {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    if (!wasClick) return;
    const picked = pickEntity(screenToWorld(canvasPoint(event)), {
      agentPositions: currentAgentPositions(),
      locations: Object.values(world.locations || {}),
      agentRadius: AGENT_RADIUS_WORLD / camera.zoom ** 0.5,
    });
    onSelect?.(picked);
  }

  function handleWheel(event) {
    event.preventDefault();
    const anchor = screenToWorld(canvasPoint(event));
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
    // Keep the world point under the cursor stationary while zooming.
    const scale = worldScale();
    const point = canvasPoint(event);
    camera.x = anchor.x - (point.x - viewWidth / 2) / scale;
    camera.y = anchor.y - (point.y - viewHeight / 2) / scale;
    clampCamera();
  }

  // -- world snapshots -------------------------------------------------------

  function currentAgentPositions() {
    const timeMs = now();
    const positions = [];
    for (const agent of Object.values(world.agents || {})) {
      const position = resolveAgentPosition(agent, world, timeMs);
      if (position) positions.push({ agentId: agent.agentId, ...position });
    }
    return positions;
  }

  // -- frame -----------------------------------------------------------------

  function tick() {
    if (!running) return;
    frameHandle = window.requestAnimationFrame(tick);
    draw();
  }

  function draw() {
    const ratio = window.devicePixelRatio || 1;
    const timeMs = now();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, viewWidth, viewHeight);

    if (layoutDirty) {
      rebuildStaticLayers();
      layoutDirty = false;
    }
    const daytime = resolveDaytime(world.calendar, timeMs);

    drawStaticBake();
    drawWaterShimmer(timeMs);
    drawTrafficHeat(timeMs);
    drawBuildings(timeMs, daytime);
    drawAgents(timeMs);
    drawConversationLinks(timeMs);
    drawLampGlows(daytime);
    drawWildlife(timeMs, daytime);
    drawPulseTicker(timeMs);
    weather.draw(ctx, viewWidth, viewHeight, timeMs);
    drawDaytimeOverlays(daytime);
    drawSelection();
  }

  // -- static bake -----------------------------------------------------------

  function rebuildStaticLayers() {
    network = computeRoadNetwork(world.locations);
    world.roads = network;
    waterRects = computeWaterRegions(world.locations);
    scenery = computeScenery(world.locations, network, waterRects);
    const snowCover = weather.kind() === 'snowy';

    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = TERRAIN_BITMAP_PX;
    terrainCanvas.height = TERRAIN_BITMAP_PX;
    const layer = terrainCanvas.getContext('2d');
    layer.imageSmoothingEnabled = false;
    const tilePx = TERRAIN_BITMAP_PX / TERRAIN_GRID;
    const toPx = (value) => value * TERRAIN_BITMAP_PX;

    drawGrassLayer(layer, tilePx);
    drawRegionGround(layer, toPx);
    drawWaterLayer(layer, waterRects, toPx);
    drawPlazaLayer(layer, tilePx);
    drawRoadLayer(layer, network, toPx);
    drawSceneryLayer(layer, scenery.items, snowCover, toPx);
    drawLamppostLayer(layer, scenery.lampposts, toPx);
  }

  function drawGrassLayer(layer, tilePx) {
    for (let row = 0; row < TERRAIN_GRID; row += 1) {
      for (let col = 0; col < TERRAIN_GRID; col += 1) {
        const variant = TERRAIN_TILES.grass[(row * 7 + col * 13) % TERRAIN_TILES.grass.length];
        drawTile(layer, variant, col * tilePx, row * tilePx, tilePx, tilePx, grassFallback);
      }
    }
  }

  function drawRegionGround(layer, toPx) {
    const tones = regionGroundTones(world.locations, world.regionalLandValues);
    for (const bounds of regionBounds(world.locations)) {
      const tone = tones.get(bounds.regionId);
      if (tone) {
        layer.fillStyle = `rgba(214, 178, 106, ${tone.alpha.toFixed(3)})`;
        layer.fillRect(
          toPx(bounds.rect.x - bounds.rect.width / 2),
          toPx(bounds.rect.y - bounds.rect.height / 2),
          toPx(bounds.rect.width),
          toPx(bounds.rect.height),
        );
      }
      // Small region name plate at the bounding box's top-left.
      const label = regionLabel(bounds.regionId);
      const fontSize = toPx(0.018);
      layer.font = `600 ${fontSize}px 'Avenir Next', Avenir, sans-serif`;
      const width = layer.measureText(label).width + fontSize * 0.9;
      const x = toPx(bounds.rect.x - bounds.rect.width / 2);
      const y = toPx(bounds.rect.y - bounds.rect.height / 2) - fontSize * 1.7;
      layer.fillStyle = 'rgba(251, 250, 246, 0.72)';
      layer.fillRect(x, y, width, fontSize * 1.5);
      layer.fillStyle = 'rgba(66, 79, 70, 0.9)';
      layer.textAlign = 'left';
      layer.textBaseline = 'middle';
      layer.fillText(label, x + fontSize * 0.45, y + fontSize * 0.78);
      layer.textBaseline = 'alphabetic';
    }
  }

  function drawWaterLayer(layer, waterRects, toPx) {
    for (const water of waterRects) {
      const left = toPx(water.rect.x - water.rect.width / 2);
      const top = toPx(water.rect.y - water.rect.height / 2);
      const width = toPx(water.rect.width);
      const height = toPx(water.rect.height);
      // Sandy shoreline along the band's near edge (the smaller y side).
      layer.fillStyle = '#d8c48a';
      layer.fillRect(left, top - 5, width, 9);
      layer.fillStyle = '#4a7fa8';
      layer.fillRect(left, top + 3, width, height - 3);
      // Deterministic pixel ripple noise baked into the base.
      for (let index = 0; index < 90; index += 1) {
        const hash = hashAgentId(`${water.regionId}:ripple:${index}`);
        const x = left + ((hash >>> 3) % 1000) / 1000 * width;
        const y = top + 10 + ((hash >>> 11) % 1000) / 1000 * Math.max(1, height - 14);
        layer.fillStyle = index % 3 === 0 ? 'rgba(126, 168, 204, 0.5)' : 'rgba(58, 96, 132, 0.55)';
        layer.fillRect(x, y, 7, 2);
      }
    }
  }

  function drawPlazaLayer(layer, tilePx) {
    const square = world.locations?.['town-square']?.mapPosition;
    if (!square) return;
    const left = ((square.x - square.width / 2) * TERRAIN_GRID) | 0;
    const top = ((square.y - square.height / 2) * TERRAIN_GRID) | 0;
    const cols = Math.ceil(square.width * TERRAIN_GRID);
    const rows = Math.ceil(square.height * TERRAIN_GRID);
    for (let row = top; row < top + rows; row += 1) {
      for (let col = left; col < left + cols; col += 1) {
        const variant = TERRAIN_TILES.plaza[(row + col) % TERRAIN_TILES.plaza.length];
        drawTile(layer, variant, col * tilePx, row * tilePx, tilePx, tilePx, plazaFallback);
      }
    }
  }

  function drawRoadLayer(layer, roadNetwork, toPx) {
    layer.lineCap = 'round';
    layer.lineJoin = 'round';
    for (const edge of roadNetwork.edges) {
      strokeWaypoints(layer, edge.waypoints, 'rgba(105, 88, 60, 0.95)', toPx(ROAD_WIDTH_WORLD) + 5);
      strokeWaypoints(layer, edge.waypoints, 'rgba(146, 124, 88, 0.92)', toPx(ROAD_WIDTH_WORLD));
      layer.setLineDash([10, 13]);
      strokeWaypoints(layer, edge.waypoints, 'rgba(181, 161, 124, 0.65)', 3);
      layer.setLineDash([]);
    }
  }

  function strokeWaypoints(layer, waypoints, color, widthPx) {
    layer.strokeStyle = color;
    layer.lineWidth = widthPx;
    layer.beginPath();
    layer.moveTo(waypoints[0].x * TERRAIN_BITMAP_PX, waypoints[0].y * TERRAIN_BITMAP_PX);
    for (let index = 1; index < waypoints.length; index += 1) {
      layer.lineTo(waypoints[index].x * TERRAIN_BITMAP_PX, waypoints[index].y * TERRAIN_BITMAP_PX);
    }
    layer.stroke();
  }

  function drawSceneryLayer(layer, items, snowCover, toPx) {
    for (const item of items) {
      const x = toPx(item.x);
      const y = toPx(item.y);
      const size = toPx(0.032) * item.scale;
      if (item.type === 'tree') {
        layer.fillStyle = '#5d4327';
        layer.fillRect(x - size * 0.09, y, size * 0.18, size * 0.42);
        const canopy = TREE_CANOPIES[item.tone % TREE_CANOPIES.length];
        layer.fillStyle = canopy;
        layer.fillRect(x - size * 0.34, y - size * 0.62, size * 0.68, size * 0.52);
        layer.fillRect(x - size * 0.24, y - size * 0.88, size * 0.48, size * 0.34);
        if (snowCover) {
          layer.fillStyle = 'rgba(235, 240, 246, 0.75)';
          layer.fillRect(x - size * 0.24, y - size * 0.88, size * 0.48, size * 0.16);
          layer.fillRect(x - size * 0.34, y - size * 0.62, size * 0.68, size * 0.12);
        }
      } else if (item.type === 'bush') {
        layer.fillStyle = TREE_CANOPIES[(item.tone + 1) % TREE_CANOPIES.length];
        layer.fillRect(x - size * 0.3, y - size * 0.28, size * 0.6, size * 0.4);
        layer.fillStyle = 'rgba(0, 0, 0, 0.16)';
        layer.fillRect(x - size * 0.3, y + size * 0.05, size * 0.6, size * 0.08);
        if (snowCover) {
          layer.fillStyle = 'rgba(235, 240, 246, 0.6)';
          layer.fillRect(x - size * 0.3, y - size * 0.28, size * 0.6, size * 0.12);
        }
      } else if (item.type === 'rock') {
        layer.fillStyle = '#8d8d86';
        layer.fillRect(x - size * 0.22, y - size * 0.2, size * 0.44, size * 0.3);
        layer.fillStyle = '#a5a59d';
        layer.fillRect(x - size * 0.22, y - size * 0.2, size * 0.24, size * 0.14);
      } else if (item.type === 'flower') {
        layer.fillStyle = FLOWER_COLORS[item.tone % FLOWER_COLORS.length];
        const dot = Math.max(2, size * 0.12);
        layer.fillRect(x - size * 0.18, y, dot, dot);
        layer.fillRect(x + size * 0.08, y - size * 0.14, dot, dot);
        layer.fillRect(x - size * 0.02, y + size * 0.1, dot, dot);
      }
    }
  }

  function drawLamppostLayer(layer, lampposts, toPx) {
    for (const lamp of lampposts) {
      const x = toPx(lamp.x);
      const y = toPx(lamp.y);
      const height = toPx(0.02);
      layer.fillStyle = '#3c3630';
      layer.fillRect(x - 1.5, y - height, 3, height);
      layer.fillStyle = '#e8c26a';
      layer.fillRect(x - 3, y - height - 4, 6, 5);
    }
  }

  function grassFallback(layer, x, y, w, h) {
    layer.fillStyle = '#568a54';
    layer.fillRect(x, y, w + 1, h + 1);
  }

  function plazaFallback(layer, x, y, w, h) {
    layer.fillStyle = '#969892';
    layer.fillRect(x, y, w + 1, h + 1);
  }

  function drawTile(layer, tile, x, y, w, h, fallback) {
    if (!tilesheet) {
      fallback(layer, x, y, w, h);
      return;
    }
    const rect = tileRect(tile);
    layer.drawImage(tilesheet, rect.sx, rect.sy, rect.sw, rect.sh, x, y, w + 1, h + 1);
  }

  function drawStaticBake() {
    if (!terrainCanvas) return;
    const topLeft = worldToScreen({ x: 0, y: 0 });
    const size = worldScale();
    ctx.drawImage(terrainCanvas, topLeft.x, topLeft.y, size, size);
  }

  // -- dynamic world layers --------------------------------------------------

  function drawWaterShimmer(timeMs) {
    const scale = worldScale();
    for (const water of waterRects) {
      const rect = water.rect;
      for (let index = 0; index < 4; index += 1) {
        const hash = hashAgentId(`${water.regionId}:shimmer:${index}`);
        const alpha = 0.05 + 0.05 * Math.sin(timeMs / 850 + index * 1.3 + (hash % 7));
        const drift = Math.sin(timeMs / 1300 + index * 1.9 + (hash % 5)) * 0.5;
        const y = rect.y - rect.height / 2 + rect.height * (index + 0.5) / 4;
        const center = worldToScreen({
          x: rect.x + drift * rect.width * 0.18,
          y,
        });
        ctx.strokeStyle = `rgba(207, 228, 242, ${Math.max(0, alpha).toFixed(3)})`;
        ctx.lineWidth = Math.max(1, scale * 0.004);
        ctx.beginPath();
        ctx.moveTo(center.x - rect.width * scale * 0.18, center.y);
        ctx.lineTo(center.x + rect.width * scale * 0.18, center.y);
        ctx.stroke();
      }
    }
  }

  function drawTrafficHeat(timeMs) {
    const flows = aggregateEdgeFlows(world.transitByAgent);
    if (flows.size === 0) return;
    const scale = worldScale();
    const pulse = 1 + 0.12 * Math.sin(timeMs / 280);
    for (const edge of network.edges) {
      const flow = flows.get(edge.key);
      const level = congestionLevel(flow);
      if (level <= 0.08) continue;
      const width = Math.max(2, scale * ROAD_WIDTH_WORLD * level * pulse);
      strokeScreenWaypoints(edge.waypoints, congestionColor(level), width);
      if (level >= 0.5) {
        const mid = positionAlongWaypoints(edge.waypoints, 0.5);
        if (!mid) continue;
        const screen = worldToScreen(mid);
        const radius = Math.max(7, scale * 0.008);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(30, 24, 18, 0.78)';
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd98a';
        ctx.font = `700 ${Math.round(radius * 1.1)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(flow.count), screen.x, screen.y);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  function strokeScreenWaypoints(waypoints, color, widthPx) {
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const first = worldToScreen(waypoints[0]);
    ctx.moveTo(first.x, first.y);
    for (let index = 1; index < waypoints.length; index += 1) {
      const screen = worldToScreen(waypoints[index]);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.stroke();
  }

  // -- buildings ---------------------------------------------------------------

  function computeOccupancy() {
    const occupancy = {};
    for (const agent of Object.values(world.agents || {})) {
      if (agent.locationId) occupancy[agent.locationId] = (occupancy[agent.locationId] || 0) + 1;
    }
    return occupancy;
  }

  function drawBuildings(timeMs, daytime) {
    occupancyByLocation = computeOccupancy();
    const scale = worldScale();
    const fontSize = Math.max(9, Math.min(13, scale * 0.014));
    ctx.font = `600 ${fontSize}px 'Avenir Next', Avenir, sans-serif`;
    ctx.textAlign = 'center';
    for (const location of Object.values(world.locations || {})) {
      const rect = location.mapPosition;
      if (!rect) continue;
      const sprite = buildingRect(location.locationId, 1);
      const drawWidth = Math.max(rect.width * scale, sprite.sw * camera.zoom * 0.75);
      const center = worldToScreen({ x: rect.x, y: rect.y });
      const bottom = center.y + (rect.height * scale) / 2;
      if (tilesheet) {
        ctx.drawImage(
          tilesheet,
          sprite.sx,
          sprite.sy,
          sprite.sw,
          sprite.sh,
          center.x - drawWidth / 2,
          bottom - drawWidth,
          drawWidth,
          drawWidth,
        );
      } else {
        ctx.fillStyle = '#8a7a5c';
        ctx.fillRect(center.x - drawWidth / 2, bottom - drawWidth, drawWidth, drawWidth);
      }
      const count = occupancyByLocation[location.locationId] || 0;
      drawNightWindows(location, count, center.x, bottom - drawWidth, drawWidth, daytime);
      drawChimneySmoke(location, count, center.x, bottom - drawWidth, drawWidth, timeMs);
      drawBuildingLabel(location, count, center.x, bottom, fontSize);
    }
  }

  /** Warm windows lit by residents at night; lit fraction follows occupancy. */
  function drawNightWindows(location, count, left, top, width, daytime) {
    if (!isNightlightTime(daytime)) return;
    const capacity = typeof location.capacity === 'number' && location.capacity > 0 ? location.capacity : null;
    const litFraction = capacity ? Math.min(1, count / capacity) : Math.min(1, count / 8);
    const litCount = count > 0 ? Math.max(1, Math.round(litFraction * 6)) : 0;
    if (litCount === 0) return;
    const rotation = hashAgentId(`${location.locationId}:windows`) % 6;
    const windowWidth = width / 7;
    const windowHeight = width / 9;
    for (let index = 0; index < 6; index += 1) {
      const lit = (index + rotation) % 6 < litCount;
      if (!lit) continue;
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = left + width * (0.24 + column * 0.26) - windowWidth / 2;
      const y = top + width * (0.22 + row * 0.3);
      ctx.fillStyle = 'rgba(255, 213, 128, 0.28)';
      ctx.fillRect(x - 1.5, y - 1.5, windowWidth + 3, windowHeight + 3);
      ctx.fillStyle = 'rgba(255, 219, 143, 0.92)';
      ctx.fillRect(x, y, windowWidth, windowHeight);
    }
  }

  /** Chimney smoke puffs over busy production/food buildings. */
  function drawChimneySmoke(location, count, left, top, width, timeMs) {
    if (count === 0 || !SMOKE_KINDS.has(location.kind)) return;
    const hash = hashAgentId(`${location.locationId}:smoke`);
    const chimneyX = left + width * 0.72;
    const chimneyY = top + width * 0.08;
    for (let index = 0; index < 3; index += 1) {
      const cycle = ((timeMs / 2800 + index / 3 + (hash % 10) / 10) % 1 + 1) % 1;
      const radius = width * (0.03 + cycle * 0.05);
      const y = chimneyY - cycle * width * 0.55;
      const x = chimneyX + Math.sin(cycle * Math.PI * 2 + index) * width * 0.05;
      ctx.fillStyle = `rgba(214, 214, 218, ${((1 - cycle) * 0.3).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBuildingLabel(location, count, x, y, fontSize) {
    const text = `${location.name || location.locationId} · ${count}`;
    const width = ctx.measureText(text).width + 10;
    ctx.fillStyle = LABEL_PLATE;
    ctx.fillRect(x - width / 2, y + 3, width, fontSize + 6);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(text, x, y + 3 + fontSize + 1);
  }

  // -- agents ------------------------------------------------------------------

  function drawAgents(timeMs) {
    const scale = worldScale();
    const size = AGENT_SIZE_WORLD * scale;
    const markers = world.markersByAgent || {};
    const bubbles = computeActivityBubbles(world.activityTimeByAgent, timeMs);
    agentScreensById = new Map();
    for (const agent of currentAgentPositions()) {
      const hash = hashAgentId(agent.agentId);
      const bob = agent.state === 'transit' ? 1 : 0.5;
      const offsetY = Math.sin(timeMs / 150 + (hash % 7)) * size * 0.04 * bob;
      const screen = worldToScreen({ x: agent.x, y: agent.y + offsetY / scale });
      agentScreensById.set(agent.agentId, screen);
      const frame = agent.state === 'transit' ? Math.floor(timeMs / 240) % 2 : 0;
      const spriteTop = screen.y - size * 0.85;
      if (tilesheet) {
        const sprite = agentRect(agent.direction, frame);
        ctx.drawImage(
          tilesheet,
          sprite.sx,
          sprite.sy,
          sprite.sw,
          sprite.sh,
          screen.x - size / 2,
          spriteTop,
          size,
          size,
        );
        // Deterministic shirt band so citizens read as individuals.
        const palette = AGENT_PALETTE[hash % AGENT_PALETTE.length];
        ctx.fillStyle = palette;
        ctx.fillRect(
          screen.x - size * 0.18,
          spriteTop + size * 0.44,
          size * 0.36,
          Math.max(1.5, size * 0.16),
        );
      } else {
        ctx.fillStyle = AGENT_PALETTE[hash % AGENT_PALETTE.length];
        ctx.fillRect(screen.x - size / 2, spriteTop, size, size);
      }
      drawActivityBubble(bubbles[agent.agentId], screen.x, spriteTop, size, hash, timeMs);
      drawAgentMarkers(markers[agent.agentId], screen.x, spriteTop, size);
    }
  }

  /** Small pixel-icon bubble for an ongoing activity (sleep z's, hammer…). */
  function drawActivityBubble(icon, x, top, size, hash, timeMs) {
    if (!icon) return;
    const bobY = Math.sin(timeMs / 320 + (hash % 5)) * 2;
    const boxSize = Math.max(9, size * 0.5);
    const boxX = x + size * 0.38;
    const boxY = top - boxSize - 5 + bobY;
    ctx.fillStyle = 'rgba(252, 250, 243, 0.94)';
    ctx.strokeStyle = 'rgba(60, 56, 48, 0.55)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, boxX, boxY, boxSize, boxSize, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(boxX + boxSize * 0.22, boxY + boxSize);
    ctx.lineTo(boxX + boxSize * 0.12, boxY + boxSize + 4);
    ctx.lineTo(boxX + boxSize * 0.48, boxY + boxSize);
    ctx.closePath();
    ctx.fillStyle = 'rgba(252, 250, 243, 0.94)';
    ctx.fill();
    drawActivityIcon(icon, boxX + boxSize / 2, boxY + boxSize / 2, boxSize);
  }

  function drawActivityIcon(icon, cx, cy, boxSize) {
    const unit = boxSize / 9;
    ctx.save();
    ctx.translate(cx, cy);
    if (icon === 'zzz') {
      ctx.fillStyle = '#4c5a8a';
      ctx.font = `700 ${Math.round(unit * 4.6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('z', -unit * 1.1, unit * 0.9);
      ctx.font = `700 ${Math.round(unit * 3.4)}px sans-serif`;
      ctx.fillText('z', unit * 1.6, -unit * 1.2);
      ctx.textBaseline = 'alphabetic';
    } else if (icon === 'book') {
      ctx.fillStyle = '#8a4f3d';
      ctx.fillRect(-unit * 3, -unit * 2, unit * 2.8, unit * 4);
      ctx.fillStyle = '#a8654e';
      ctx.fillRect(unit * 0.2, -unit * 2, unit * 2.8, unit * 4);
      ctx.fillStyle = '#f0e6d2';
      ctx.fillRect(-unit * 2.6, -unit * 1.2, unit * 2, unit * 0.8);
      ctx.fillRect(unit * 0.6, -unit * 1.2, unit * 2, unit * 0.8);
      ctx.fillRect(-unit * 2.6, unit * 0.4, unit * 2, unit * 0.8);
      ctx.fillRect(unit * 0.6, unit * 0.4, unit * 2, unit * 0.8);
    } else if (icon === 'hammer') {
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(-unit * 2.6, -unit * 2.4, unit * 5.2, unit * 2);
      ctx.fillStyle = '#8a6b42';
      ctx.fillRect(-unit * 0.8, -unit * 0.4, unit * 1.6, unit * 3.6);
    } else if (icon === 'coin') {
      ctx.fillStyle = '#c9971f';
      ctx.beginPath();
      ctx.arc(0, 0, unit * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2d06b';
      ctx.font = `700 ${Math.round(unit * 4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, unit * 0.4);
      ctx.textBaseline = 'alphabetic';
    } else if (icon === 'cross') {
      ctx.fillStyle = '#3f8a5f';
      ctx.fillRect(-unit, -unit * 3, unit * 2, unit * 6);
      ctx.fillRect(-unit * 3, -unit, unit * 6, unit * 2);
    }
    ctx.restore();
  }

  function drawAgentMarkers(agentMarkers, x, top, size) {
    if (!agentMarkers?.length) return;
    const radius = Math.max(3.5, size * 0.16);
    agentMarkers.slice(0, 3).forEach((marker, index) => {
      const cx = x + size * 0.4 + index * radius * 2.4;
      const cy = top - radius * 1.6;
      ctx.beginPath();
      ctx.fillStyle = MARKER_COLORS[marker.kind] || '#747b75';
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbfaf6';
      ctx.font = `700 ${radius * 1.4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(marker.kind === 'conflict' ? '!' : '·', cx, cy + radius * 0.5);
    });
  }

  // -- conversations, lamps, wildlife, news ------------------------------------

  function drawConversationLinks(timeMs) {
    const links = computeConversationLinks(world.conversationRecords, timeMs);
    if (links.length === 0) return;
    for (const link of links) {
      const points = link.participantAgentIds
        .map((agentId) => agentScreensById.get(agentId))
        .filter(Boolean);
      if (points.length < 2) continue;
      const alpha = Math.max(0, 1 - link.age01) * 0.55;
      ctx.strokeStyle = `rgba(240, 232, 200, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y - 6);
      for (let index = 1; index < Math.min(points.length, 4); index += 1) {
        ctx.lineTo(points[index].x, points[index].y - 6);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Chat dots above the initiator.
      const bob = Math.sin(timeMs / 260) * 1.5;
      const bx = points[0].x - 9;
      const by = points[0].y - 24 + bob;
      ctx.fillStyle = 'rgba(252, 250, 243, 0.95)';
      ctx.strokeStyle = 'rgba(60, 56, 48, 0.5)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, bx, by, 18, 10, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6b7280';
      for (let dot = 0; dot < 3; dot += 1) {
        const visible = Math.floor(timeMs / 380) % 3;
        ctx.globalAlpha = dot <= visible ? 1 : 0.3;
        ctx.beginPath();
        ctx.arc(bx + 4.5 + dot * 4.5, by + 5, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawLampGlows(daytime) {
    if (daytime?.darkness === undefined || daytime.darkness < 0.35) return;
    const scale = worldScale();
    const alpha = 0.3 * daytime.darkness;
    for (const lamp of scenery.lampposts) {
      const screen = worldToScreen(lamp);
      const radius = scale * 0.05;
      const gradient = ctx.createRadialGradient(
        screen.x,
        screen.y - scale * 0.02,
        radius * 0.1,
        screen.x,
        screen.y - scale * 0.02,
        radius,
      );
      gradient.addColorStop(0, `rgba(255, 214, 140, ${alpha.toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(255, 214, 140, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y - scale * 0.02, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Birds by day, fireflies near trees at night — deterministic, decorative. */
  function drawWildlife(timeMs, daytime) {
    const darkness = daytime?.darkness ?? 0;
    const weatherKind = weather.kind();
    if (darkness < 0.35 && (!weatherKind || QUIET_WEATHER.has(weatherKind))) {
      for (let index = 0; index < 3; index += 1) {
        const progress = ((timeMs / 21000 + index * 0.37) % 1 + 1) % 1;
        const x = progress * (viewWidth + 80) - 40;
        const y = 36 + index * 54 + 34 * Math.sin(timeMs / 1900 + index * 2.3);
        const flap = Math.sin(timeMs / 110 + index * 1.7) > 0 ? 2.4 : -0.6;
        ctx.strokeStyle = 'rgba(60, 70, 82, 0.72)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - flap);
        ctx.lineTo(x, y);
        ctx.lineTo(x + 4, y - flap);
        ctx.stroke();
      }
    }
    if (darkness > 0.55 && (!weatherKind || QUIET_WEATHER.has(weatherKind))) {
      const trees = scenery.items.filter((item) => item.type === 'tree').slice(0, 10);
      for (let index = 0; index < trees.length; index += 1) {
        const tree = trees[index];
        const hash = hashAgentId(`firefly:${index}`);
        const glow = Math.max(0, Math.sin(timeMs / 650 + index * 2.7 + (hash % 6)));
        if (glow < 0.15) continue;
        const screen = worldToScreen({
          x: tree.x + Math.sin(timeMs / 900 + index * 1.3) * 0.012,
          y: tree.y + Math.cos(timeMs / 780 + index * 1.9) * 0.01 - 0.01,
        });
        ctx.fillStyle = `rgba(216, 240, 138, ${(glow * 0.55).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Town-pulse news ticker in the lower-left corner (authoritative ring). */
  function drawPulseTicker(timeMs) {
    const entries = computePulseTicker(world.townPulse, timeMs);
    if (entries.length === 0) return;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 11px 'Avenir Next', Avenir, sans-serif`;
    entries.forEach((entry, index) => {
      const described = describePulseRecord(entry);
      const alpha = Math.max(0, 1 - entry.age01 * 0.9);
      if (alpha <= 0.02) return;
      const text = `${described.icon}  ${described.text}`;
      const width = ctx.measureText(text).width + 18;
      const x = 14;
      const y = viewHeight - 66 - index * 26;
      ctx.fillStyle = `rgba(24, 30, 27, ${(0.72 * alpha).toFixed(3)})`;
      roundRectPath(ctx, x, y - 10, width, 20, 6);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 217, 138, ${alpha.toFixed(3)})`;
      ctx.fillText(described.icon, x + 8, y);
      ctx.fillStyle = `rgba(240, 237, 228, ${alpha.toFixed(3)})`;
      ctx.fillText(described.text, x + 24, y);
    });
    ctx.textBaseline = 'alphabetic';
  }

  function drawDaytimeOverlays(daytime) {
    const overlays = daytimeOverlays(daytime);
    if (!overlays) return;
    for (const overlay of overlays) {
      ctx.fillStyle = overlay.color;
      ctx.fillRect(0, 0, viewWidth, viewHeight);
    }
  }

  // -- selection ---------------------------------------------------------------

  function drawSelection() {
    if (!selection) return;
    ctx.save();
    if (selection.type === 'location') {
      const rect = world.locations?.[selection.id]?.mapPosition;
      if (rect) {
        const scale = worldScale();
        const center = worldToScreen(rect);
        const width = rect.width * scale + 14;
        const height = rect.height * scale + 14;
        drawBracket(center.x - width / 2, center.y - height / 2, width, height);
      }
    } else if (selection.type === 'agent') {
      const agent = Object.values(world.agents || {}).find(
        (candidate) => candidate.agentId === selection.id,
      );
      const position = agent ? resolveAgentPosition(agent, world, now()) : null;
      if (position) {
        const scale = worldScale();
        const size = AGENT_SIZE_WORLD * scale + 10;
        const screen = worldToScreen(position);
        drawBracket(screen.x - size / 2, screen.y - size * 0.9, size, size);
      }
    }
    ctx.restore();
  }

  function drawBracket(x, y, width, height) {
    if (tilesheet) {
      const sprite = tileRect(SELECTION_TILE);
      ctx.drawImage(tilesheet, sprite.sx, sprite.sy, sprite.sw, sprite.sh, x, y, width, height);
    } else {
      ctx.strokeStyle = '#faf0a0';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
    }
  }

  /** Manual rounded-rect path (avoids depending on `ctx.roundRect`). */
  function roundRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  return {
    /** Replace the world snapshot; re-renders cached layers on next frame. */
    setWorld(nextWorld) {
      world = nextWorld || emptyWorld();
      network = computeRoadNetwork(world.locations);
      world.roads = network;
      weather.setWeather(world.weather);
      layoutDirty = true;
    },

    setSelection(nextSelection) {
      selection = nextSelection;
    },

    /** Reset the camera to the whole-town framing (used by the map controls). */
    resetCamera() {
      camera.x = 0.5;
      camera.y = 0.5;
      camera.zoom = 1;
    },

    zoomBy(factor) {
      camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
    },

    destroy() {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    },
  };
}

/**
 * Canvas renderer for the living-town map.
 *
 * Layer pipeline per frame: terrain (cached offscreen) → routes (cached) →
 * buildings → agents → weather → selection. The camera supports drag pan and
 * wheel zoom (clamped). The rAF loop only runs while the tab is visible.
 *
 * All geometry lives in normalized world coordinates (0-1, y down) matching
 * the projection `mapPosition` contract. Agent movement is client-side
 * interpolation (see `interpolation.js`) — the canvas never claims real
 * coordinates.
 */
import {
  TERRAIN_TILES,
  SELECTION_TILE,
  agentRect,
  buildingRect,
  loadTilesheet,
  tileRect,
} from './tilesheet.js';
import { resolveAgentPosition } from './interpolation.js';
import { createWeatherLayer } from './weatherLayer.js';
import { pickEntity } from './picking.js';

const TERRAIN_GRID = 28; // terrain tiles per world axis
const TERRAIN_BITMAP_PX = 1120; // offscreen resolution for terrain + routes
const AGENT_RADIUS_WORLD = 0.02;
const AGENT_SIZE_WORLD = 0.026;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 5;
const ROUTE_COLOR = 'rgba(146, 124, 88, 0.9)';
const ROUTE_EDGE_COLOR = 'rgba(105, 88, 60, 0.9)';
const LABEL_COLOR = '#23302a';
const LABEL_PLATE = 'rgba(251, 250, 246, 0.85)';
const MARKER_COLORS = { condition: '#946720', conflict: '#a44d38' };

export function createMapRenderer({ canvas, getNow, onSelect }) {
  const ctx = canvas.getContext('2d');
  const weather = createWeatherLayer();
  const camera = { x: 0.5, y: 0.5, zoom: 1 };
  let tilesheet = null;
  let world = { locations: {}, agents: {}, transitByAgent: {}, markersByAgent: {} };
  let selection = null;
  let frameHandle = 0;
  let running = false;
  let layoutDirty = true;
  let viewWidth = 0;
  let viewHeight = 0;
  let drag = null;
  let terrainCanvas = null;

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
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, viewWidth, viewHeight);

    if (layoutDirty) {
      rebuildStaticLayers();
      layoutDirty = false;
    }
    drawTerrainAndRoutes();
    drawBuildings();
    drawAgents();
    weather.draw(ctx, viewWidth, viewHeight, now());
    drawSelection();
  }

  function rebuildStaticLayers() {
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = TERRAIN_BITMAP_PX;
    terrainCanvas.height = TERRAIN_BITMAP_PX;
    const layer = terrainCanvas.getContext('2d');
    layer.imageSmoothingEnabled = false;
    const tilePx = TERRAIN_BITMAP_PX / TERRAIN_GRID;

    for (let row = 0; row < TERRAIN_GRID; row += 1) {
      for (let col = 0; col < TERRAIN_GRID; col += 1) {
        const variant = TERRAIN_TILES.grass[(row * 7 + col * 13) % TERRAIN_TILES.grass.length];
        drawTile(layer, variant, col * tilePx, row * tilePx, tilePx, tilePx, grassFallback);
      }
    }
    // Plaza paving inside the town-square rect.
    const square = world.locations?.['town-square']?.mapPosition;
    if (square) {
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
    drawRoutes(layer);
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

  function drawRoutes(layer) {
    const locations = world.locations || {};
    const drawn = new Set();
    const toBitmap = (point) => point * TERRAIN_BITMAP_PX;
    for (const location of Object.values(locations)) {
      if (!location.mapPosition || !Array.isArray(location.connections)) continue;
      for (const connection of location.connections) {
        const target = locations[connection.targetLocationId];
        if (!target?.mapPosition) continue;
        const key = [location.locationId, target.locationId].sort().join(':');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const width = TERRAIN_BITMAP_PX * 0.012;
        layer.lineCap = 'round';
        layer.strokeStyle = ROUTE_EDGE_COLOR;
        layer.lineWidth = width + 4;
        layer.beginPath();
        layer.moveTo(toBitmap(location.mapPosition.x), toBitmap(location.mapPosition.y));
        layer.lineTo(toBitmap(target.mapPosition.x), toBitmap(target.mapPosition.y));
        layer.stroke();
        layer.strokeStyle = ROUTE_COLOR;
        layer.lineWidth = width;
        layer.beginPath();
        layer.moveTo(toBitmap(location.mapPosition.x), toBitmap(location.mapPosition.y));
        layer.lineTo(toBitmap(target.mapPosition.x), toBitmap(target.mapPosition.y));
        layer.stroke();
      }
    }
  }

  function drawTerrainAndRoutes() {
    if (!terrainCanvas) return;
    const topLeft = worldToScreen({ x: 0, y: 0 });
    const size = worldScale();
    ctx.drawImage(terrainCanvas, topLeft.x, topLeft.y, size, size);
  }

  function drawBuildings() {
    const occupancy = {};
    for (const agent of Object.values(world.agents || {})) {
      if (agent.locationId) occupancy[agent.locationId] = (occupancy[agent.locationId] || 0) + 1;
    }
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
      drawBuildingLabel(location, occupancy[location.locationId] || 0, center.x, bottom, fontSize);
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

  function drawAgents() {
    const scale = worldScale();
    const size = AGENT_SIZE_WORLD * scale;
    const timeMs = now();
    const markers = world.markersByAgent || {};
    for (const agent of currentAgentPositions()) {
      const screen = worldToScreen(agent);
      const frame = agent.state === 'transit' ? Math.floor(timeMs / 240) % 2 : 0;
      if (tilesheet) {
        const sprite = agentRect(agent.direction, frame);
        ctx.drawImage(
          tilesheet,
          sprite.sx,
          sprite.sy,
          sprite.sw,
          sprite.sh,
          screen.x - size / 2,
          screen.y - size * 0.85,
          size,
          size,
        );
      } else {
        ctx.fillStyle = '#56609e';
        ctx.fillRect(screen.x - size / 2, screen.y - size * 0.85, size, size);
      }
      drawAgentMarkers(markers[agent.agentId], screen.x, screen.y - size * 0.85, size);
    }
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

  return {
    /** Replace the world snapshot; re-renders cached layers on next frame. */
    setWorld(nextWorld) {
      world = nextWorld || { locations: {}, agents: {}, transitByAgent: {}, markersByAgent: {} };
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

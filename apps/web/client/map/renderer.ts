// Static shader/particle synchronizers keep the server's strict CSP (no eval).
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Particle, ParticleContainer } from 'pixi.js';
import type { Citizen, Point, Selection, Town } from '../model';
import { emptyTown, record, text } from '../model';
import { computeRoadNetwork, aggregateEdgeFlows, congestionLevel } from './logic/roads.js';
import { computeActivityBubbles, computeConversationLinks } from './logic/ambient.js';
import { project, unproject, layoutKey, populationGroups } from './geometry';
import { createScenery } from './scenery';
import { loadTownArt } from './townArt';
import { hashAgentId, resolveAgentPosition } from './logic/interpolation.js';
import { resolveDaytime } from './logic/dayNight.js';

export type MapHandle = {
  setWorld: (town: Town) => void;
  select: (selection: Selection) => void;
  zoom: (factor: number) => void;
  reset: () => void;
  focus: (selection: Selection) => void;
  setLayer: (layer: string) => void;
  setActive: (active: boolean) => void;
  destroy: () => void;
};
export async function createMap(
  canvas: HTMLCanvasElement,
  onSelect: (selection: Selection) => void,
  getNow: () => number,
): Promise<MapHandle> {
  const textures = await loadTownArt();
  const app = new Application();
  await app.init({
    canvas,
    preference: 'webgl',
    backgroundAlpha: 0,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    resizeTo: canvas.parentElement ?? window,
  });
  app.ticker.maxFPS = 60;
  let town = emptyTown(),
    signature = '',
    selection: Selection = null,
    mode = 'life';
  let art: ReturnType<typeof createScenery> | undefined;
  let groups = populationGroups(town);
  let flows = aggregateEdgeFlows(town.transitByAgent);
  let active = true;
  let interpolationWorld = { ...town, roads: computeRoadNetwork({}) };
  const world = new Container();
  const particles = new ParticleContainer({
    dynamicProperties: { position: true, color: true },
    roundPixels: true,
  });
  const effects = new Graphics(),
    highlight = new Graphics(),
    atmosphere = new Graphics(),
    traffic = new Graphics();
  const camera = { x: 0, y: 0, zoom: 1 },
    target = { ...camera };
  const avatars = new Map<string, Particle>();
  let visibleCitizens: { citizen: Citizen; point: Point }[] = [];
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const scale = () => Math.min(app.screen.width / 1420, app.screen.height / 1090) * camera.zoom;
  const offset = () => ({
    x: app.screen.width / 2 - camera.x * scale(),
    y: app.screen.height / 2 + 30 - camera.y * scale(),
  });
  const localPoint = (event: PointerEvent | WheelEvent): Point => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const scenePoint = (point: Point): Point => {
    const origin = offset();
    return { x: (point.x - origin.x) / scale(), y: (point.y - origin.y) / scale() };
  };
  const position = (citizen: Citizen, now: number): Point | null => {
    const result = resolveAgentPosition(citizen, interpolationWorld, now);
    if (!result || !Number.isFinite(result.x) || !Number.isFinite(result.y)) return null;
    if (result.state === 'resident') {
      const transit = record(town.transitByAgent[citizen.agentId]);
      const location = town.locations[text(transit.toLocationId, citizen.locationId)];
      if (location) {
        // In-location drift is decorative: place residents on the forecourt, clear of roofs.
        const rect = location.mapPosition;
        const phase = Math.max(
          0,
          Math.min(1, (result.y - rect.y) / Math.max(rect.height, 0.001) + 0.5),
        );
        return { x: result.x, y: rect.y + rect.height * (0.13 + phase * 0.18) };
      }
    }
    return { x: result.x, y: result.y };
  };
  app.stage.addChild(world, atmosphere);

  function setWorld(next: Town) {
    town = next;
    groups = populationGroups(town);
    flows = aggregateEdgeFlows(town.transitByAgent);
    const nextSignature = layoutKey(town);
    if (nextSignature !== signature) {
      signature = nextSignature;
      if (art) {
        world.removeChild(art.root, art.labels);
        art.root.destroy({ children: true });
        art.labels.destroy({ children: true });
      }
      art = createScenery(town, textures);
      world.addChildAt(art.root, 0);
      world.addChild(traffic, particles, effects, art.labels, highlight);
    }
    if (art) {
      interpolationWorld = { ...town, roads: art.network };
      art.places.forEach((place) => {
        const count = groups.get(place.location.locationId)?.length ?? 0;
        place.count.text = `${count.toLocaleString()} present`;
      });
    }
    for (const id of avatars.keys()) if (!town.agents[id]) avatars.delete(id);
  }
  function draw() {
    const easing = reducedMotion.matches ? 1 : 0.15;
    camera.x += (target.x - camera.x) * easing;
    camera.y += (target.y - camera.y) * easing;
    camera.zoom += (target.zoom - camera.zoom) * easing;
    const origin = offset(),
      zoomScale = scale();
    world.position.set(origin.x, origin.y);
    world.scale.set(zoomScale);
    const now = reducedMotion.matches ? town.clock : getNow();
    const daytime = resolveDaytime(town.calendar, now);
    effects.clear();
    highlight.clear();
    traffic.clear();
    atmosphere.clear();
    const populationView = town.population > 1200 && camera.zoom < 1.8;
    const transitAggregated = (groups.get('@transit')?.length ?? 0) > 1200;
    const previousParticles = particles.particleChildren;
    const nextParticles: Particle[] = [];
    visibleCitizens = [];
    const bounds = {
      left: -origin.x / zoomScale - 60,
      right: (app.screen.width - origin.x) / zoomScale + 60,
      top: -origin.y / zoomScale - 80,
      bottom: (app.screen.height - origin.y) / zoomScale + 80,
    };
    const showCitizen = (citizen: Citizen, point: Point) => {
      let particle = avatars.get(citizen.agentId);
      if (!particle) {
        particle = new Particle({
          texture: textures.characters[hashAgentId(citizen.agentId) % textures.characters.length]!,
          anchorX: 0.5,
          anchorY: 0.85,
          scaleX: 1.5,
          scaleY: 1.5,
        });
        avatars.set(citizen.agentId, particle);
      }
      particle.x = point.x;
      particle.y =
        point.y +
        (reducedMotion.matches ? 0 : Math.sin(now / 170 + (hashAgentId(citizen.agentId) % 10)));
      nextParticles.push(particle);
      visibleCitizens.push({ citizen, point });
    };
    for (const [locationId, citizens] of groups) {
      const location = town.locations[locationId];
      if (location) {
        const point = project(location.mapPosition);
        if (
          point.x < bounds.left - 150 ||
          point.x > bounds.right + 150 ||
          point.y < bounds.top - 150 ||
          point.y > bounds.bottom + 150
        )
          continue;
        if (populationView || citizens.length > 1200 || mode === 'population') {
          effects
            .ellipse(
              point.x,
              point.y,
              18 + Math.log2(citizens.length + 1) * 5,
              9 + Math.log2(citizens.length + 1) * 2,
            )
            .fill({ color: 0x4e8161, alpha: 0.28 });
          continue;
        }
      } else if (
        locationId === '@transit' &&
        (populationView || transitAggregated || mode === 'population')
      )
        continue;
      for (const citizen of citizens) {
        const normalized = position(citizen, now);
        if (!normalized) continue;
        const point = project(normalized);
        if (
          point.x < bounds.left ||
          point.x > bounds.right ||
          point.y < bounds.top ||
          point.y > bounds.bottom
        )
          continue;
        showCitizen(citizen, point);
      }
    }
    // A selected citizen remains individually visible even inside an aggregate.
    if (
      selection?.type === 'agent' &&
      !visibleCitizens.some(({ citizen }) => citizen.agentId === selection?.id)
    ) {
      const citizen = town.agents[selection.id];
      const normalized = citizen && position(citizen, now);
      if (citizen && normalized) showCitizen(citizen, project(normalized));
    }
    const changed =
      previousParticles.length !== nextParticles.length ||
      previousParticles.some((particle, index) => particle !== nextParticles[index]);
    if (changed) {
      particles.particleChildren = nextParticles;
      particles.update();
    }
    if (art) {
      if (mode === 'routes' || populationView || transitAggregated)
        for (const edge of art.network.edges) {
          const route = edge.waypoints.map(project);
          route.forEach((point: Point, index: number) => {
            if (index === 0) traffic.moveTo(point.x, point.y);
            else traffic.lineTo(point.x, point.y);
          });
          const level = congestionLevel(flows.get(edge.key));
          traffic.stroke({
            color: level > 0.65 ? 0xb76c50 : level > 0.25 ? 0xb0a163 : 0x709e94,
            width: 3 + level * 6,
            alpha: 0.75,
          });
        }
      for (const water of art.water)
        for (let i = 0; i < 8; i++) {
          const wave = project({
            x: water.rect.x - water.rect.width * 0.4 + i * water.rect.width * 0.1,
            y: water.rect.y,
          });
          const shift = reducedMotion.matches ? 0 : Math.sin(now / 1400 + i * 1.5) * 5;
          effects
            .moveTo(wave.x - 7 + shift, wave.y)
            .lineTo(wave.x + 8 + shift, wave.y)
            .stroke({ color: 0xd7ede3, alpha: 0.35, width: 1.5 });
        }
      for (const place of art.places) {
        const labelScale = Math.min(1, 1 / Math.sqrt(camera.zoom));
        place.label.scale.set(labelScale);
        place.count.scale.set(labelScale);
      }
      // Occupancy, calendar and weather remain facts from the observed snapshot.
      if (daytime && daytime.darkness > 0.35)
        for (const place of art.places) {
          if (!groups.get(place.location.locationId)?.length) continue;
          const p = place.point;
          effects
            .ellipse(p.x, p.y - 25, 42, 22)
            .fill({ color: 0xf6d48b, alpha: daytime.darkness * 0.12 });
          for (let i = 0; i < 3; i++)
            effects
              .rect(p.x - 15 + i * 12, p.y - 23 + i * 3, 5, 6)
              .fill({ color: 0xffd78b, alpha: 0.85 });
        }
      for (const place of art.places)
        if (
          place.location.kind === 'production' &&
          (groups.get(place.location.locationId)?.length ?? 0) > 0
        ) {
          for (let i = 0; i < 3; i++) {
            const t = reducedMotion.matches ? i / 3 : (now / 3500 + i / 3) % 1;
            effects
              .circle(place.point.x + 14 + Math.sin(t * 5) * 7, place.top - t * 40, 4 + t * 8)
              .fill({ color: 0xf4eddf, alpha: (1 - t) * 0.4 });
          }
        }
    }
    const activityIcons = computeActivityBubbles(
      Object.fromEntries(
        visibleCitizens
          .slice(0, 80)
          .map(({ citizen }) => [citizen.agentId, town.activityTimeByAgent[citizen.agentId]]),
      ),
      now,
    );
    for (const item of visibleCitizens.slice(0, 80)) {
      const icon = activityIcons[item.citizen.agentId];
      if (!icon) continue;
      const x = item.point.x + 9,
        y = item.point.y - 26;
      effects.roundRect(x - 5, y - 5, 11, 10, 3).fill({ color: 0xfff9dd, alpha: 0.95 });
      effects
        .rect(x - 2, y - 2, 5, 4)
        .fill(icon === 'coin' ? 0xb59651 : icon === 'book' ? 0x728da0 : 0x7a9270);
    }
    const visibleById = new Map(visibleCitizens.map((item) => [item.citizen.agentId, item.point]));
    for (const link of computeConversationLinks(town.conversationRecords, now).slice(0, 30)) {
      const points = link.participantAgentIds
        .map((id) => visibleById.get(id))
        .filter((point): point is Point => Boolean(point));
      if (points.length < 2) continue;
      points.forEach((point, index) => {
        if (index === 0) effects.moveTo(point.x, point.y - 15);
        else effects.lineTo(point.x, point.y - 15);
      });
      effects.stroke({ color: 0xf6e9bd, alpha: 1 - link.age01, width: 2 });
    }
    if (selection) {
      let selectedPoint: Point | undefined;
      if (selection.type === 'location') selectedPoint = town.locations[selection.id]?.mapPosition;
      else {
        const citizen = town.agents[selection.id];
        if (citizen) selectedPoint = position(citizen, now) ?? undefined;
      }
      if (selectedPoint) {
        const point = project(selectedPoint);
        const radius = selection.type === 'location' ? 65 : 16;
        highlight
          .ellipse(point.x, point.y + 3, radius, radius * 0.52)
          .stroke({ color: 0xfff0ac, width: 3 });
        highlight
          .ellipse(point.x, point.y + 3, radius + 5, radius * 0.52 + 3)
          .stroke({ color: 0x49634d, width: 1, alpha: 0.5 });
      }
    }
    if (daytime)
      atmosphere
        .rect(0, 0, app.screen.width, app.screen.height)
        .fill({ color: 0x1c2949, alpha: daytime.darkness * 0.24 });
    const weather = town.weather.current;
    if (weather === 'rainy' || weather === 'stormy' || weather === 'snowy') {
      atmosphere
        .rect(0, 0, app.screen.width, app.screen.height)
        .fill({ color: 0x617e8c, alpha: 0.08 });
      for (let i = 0; i < 65; i++) {
        const seed = hashAgentId(`weather:${i}`),
          x = seed % Math.max(1, Math.floor(app.screen.width)),
          y =
            ((seed >> 10) + (reducedMotion.matches ? 0 : now / (weather === 'snowy' ? 30 : 4))) %
            app.screen.height;
        if (weather === 'snowy') atmosphere.circle(x, y, 2).fill({ color: 0xffffff, alpha: 0.7 });
        else
          atmosphere
            .moveTo(x, y)
            .lineTo(x - 3, y + 11)
            .stroke({ color: 0xd1e3e9, alpha: 0.4, width: 1 });
      }
    }
  }
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      const p = localPoint(event);
      drag = { ...p, cx: target.x, cy: target.y, moved: false };
    },
    { signal: events.signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (!drag) return;
      const point = localPoint(event),
        dx = point.x - drag.x,
        dy = point.y - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        target.x = Math.max(-1000, Math.min(1000, drag.cx - dx / scale()));
        target.y = Math.max(-700, Math.min(700, drag.cy - dy / scale()));
      }
    },
    { signal: events.signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      const clicked = drag && !drag.moved;
      drag = null;
      if (!clicked) return;
      const point = scenePoint(localPoint(event));
      const closest = visibleCitizens
        .map((item) => ({
          ...item,
          distance: Math.hypot(point.x - item.point.x, point.y - item.point.y + 8),
        }))
        .filter((item) => item.distance < 22)
        .sort((a, b) => a.distance - b.distance)[0];
      if (closest) {
        onSelect({ type: 'agent', id: closest.citizen.agentId });
        return;
      }
      const normalized = unproject(point);
      const place = art?.places
        .filter((item) => {
          const rect = item.location.mapPosition;
          return (
            (Math.abs(normalized.x - rect.x) < rect.width * 0.65 &&
              Math.abs(normalized.y - rect.y) < rect.height * 0.65) ||
            (Math.abs(point.x - item.point.x) < rect.width * 640 &&
              point.y > item.top &&
              point.y < item.point.y)
          );
        })
        .sort((a, b) => b.point.y - a.point.y)[0];
      onSelect(place ? { type: 'location', id: place.location.locationId } : null);
    },
    { signal: events.signal },
  );
  canvas.addEventListener(
    'pointercancel',
    () => {
      drag = null;
    },
    { signal: events.signal },
  );
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const point = scenePoint(localPoint(event));
      const factor = Math.exp(-event.deltaY * 0.001);
      const next = Math.max(0.65, Math.min(5, target.zoom * factor));
      const ratio = target.zoom / next;
      target.x = point.x + (target.x - point.x) * ratio;
      target.y = point.y + (target.y - point.y) * ratio;
      target.zoom = next;
    },
    { passive: false, signal: events.signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) app.stop();
      else if (active) app.start();
    },
    { signal: events.signal },
  );
  app.ticker.add(draw);
  if (document.hidden) app.stop();
  return {
    setWorld,
    select: (next) => {
      selection = next;
    },
    zoom: (factor) => {
      target.zoom = Math.max(0.65, Math.min(5, target.zoom * factor));
    },
    reset: () => {
      Object.assign(target, { x: 0, y: 0, zoom: 1 });
    },
    focus(next) {
      if (!next) return;
      const citizen = next.type === 'agent' ? town.agents[next.id] : undefined;
      const point = citizen ? position(citizen, getNow()) : town.locations[next.id]?.mapPosition;
      if (point) {
        const p = project(point);
        Object.assign(target, p, { zoom: 2.3 });
      }
    },
    setLayer: (layer) => {
      mode = layer;
    },
    setActive: (next) => {
      active = next;
      if (active && !document.hidden) app.start();
      else app.stop();
    },
    destroy() {
      events.abort();
      app.destroy({ removeView: false }, { children: true });
      textures.destroy();
      avatars.clear();
    },
  };
}

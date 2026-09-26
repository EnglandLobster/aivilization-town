import { Container, Graphics, Text, TilingSprite } from 'pixi.js';
import type { Location, Point, Town } from '../model';
import { project, WORLD_WIDTH, WORLD_HEIGHT } from './geometry';
import { computeRoadNetwork } from './logic/roads.js';
import { computeScenery, computeWaterRegions } from './logic/decor.js';
import { hashAgentId } from './logic/interpolation.js';
import { createPlaceBuilding, stamp } from './townBuildings';
import type { TownArt } from './townArt';

export type PlaceArt = { location: Location; point: Point; top: number; label: Text; count: Text };
export function createScenery(town: Town, art: TownArt) {
  const root = new Container();
  const ground = new Container();
  const left = -WORLD_WIDTH / 2,
    top = -WORLD_HEIGHT / 2;
  const snow = town.weather.current === 'snowy';
  const lawn = new TilingSprite({
    texture: art.tile(0, 24),
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  });
  lawn.position.set(left, top);
  lawn.tileScale.set(1.5);
  lawn.alpha = snow ? 0.18 : 0.5;
  ground.addChild(
    new Graphics()
      .rect(left + 10, top + 12, WORLD_WIDTH, WORLD_HEIGHT)
      .fill({ color: 0x304434, alpha: 0.12 }),
    new Graphics().rect(left, top, WORLD_WIDTH, WORLD_HEIGHT).fill(snow ? 0xe2eadf : 0xc4d2a1),
    lawn,
  );
  const network = computeRoadNetwork(town.locations);
  const water = computeWaterRegions(town.locations);
  for (const item of water) {
    const point = project(item.rect);
    const width = item.rect.width * WORLD_WIDTH,
      height = item.rect.height * WORLD_HEIGHT;
    const shore = new TilingSprite({ texture: art.water, width, height });
    shore.tileScale.set(1.5);
    shore.position.set(point.x - width / 2, point.y - height / 2);
    ground.addChild(
      new Graphics().rect(shore.x - 5, shore.y - 5, width + 10, height + 10).fill(0xc6cebc),
      shore,
    );
  }
  // Draw each authoritative connection, retaining the same waypoints for citizen interpolation.
  const roads = new Graphics();
  for (const edge of network.edges) {
    const points = edge.waypoints.map(project);
    for (const [width, color] of [
      [48, 0xa9babc],
      [38, 0xd6ddce],
      [30, 0x555d5d],
    ] as const) {
      points.forEach((p, i) => (i === 0 ? roads.moveTo(p.x, p.y) : roads.lineTo(p.x, p.y)));
      roads.stroke({ width, color, cap: 'square', join: 'miter' });
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let distance = 10; distance < length - 8; distance += 23) {
        const t = distance / length,
          end = Math.min(distance + 10, length) / length;
        roads
          .moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
          .lineTo(a.x + (b.x - a.x) * end, a.y + (b.y - a.y) * end)
          .stroke({ color: 0xe2dfbe, width: 2 });
      }
    }
  }
  ground.addChild(roads);
  root.addChild(ground);
  const scenery = computeScenery(town.locations, network, water);
  const depthItems: { depth: number; node: Container }[] = [];
  for (const item of scenery.items) {
    if (item.type !== 'tree' && item.type !== 'bush') continue;
    const point = project(item),
      node = new Container();
    const isTree = item.type === 'tree';
    const sprite = stamp(
      node,
      isTree ? art.tile(item.tone % 2 ? 34 : 36, 10, 1, 2) : art.tile(31, 13),
      point.x - 12,
      point.y - (isTree ? 44 : 15),
      isTree ? 1.7 : 1.3,
    );
    if (snow) sprite.tint = 0xdfe9e7;
    depthItems.push({ depth: point.y, node });
  }
  const places: PlaceArt[] = [];
  for (const location of Object.values(town.locations)) {
    const rect = location.mapPosition,
      point = project(rect);
    const width = rect.width * WORLD_WIDTH,
      height = rect.height * WORLD_HEIGHT;
    const plot = new Container();
    plot.position.copyFrom(point);
    const paving = new TilingSprite({
      texture: art.tile(location.kind === 'social' ? 3 : 0, 19),
      width: width * 0.88,
      height: height * 0.79,
    });
    paving.position.set(-paving.width / 2, -paving.height / 2);
    paving.tileScale.set(1.5);
    plot.addChild(
      new Graphics()
        .rect(paving.x - 3, paving.y - 3, paving.width + 6, paving.height + 6)
        .fill(0xc3cfb9),
      paving,
    );
    ground.addChild(plot);
    const building = createPlaceBuilding(location, art);
    // Small scenario plots scale their artwork, keeping it inside the authoritative place.
    const fit = Math.min(1, width / 320, height / 300);
    building.root.scale.set(fit);
    building.root.position.set(point.x, point.y - 7);
    depthItems.push({ depth: point.y + 60 * fit, node: building.root });
    // Street furniture is cosmetic; it creates no new simulation entities.
    for (const direction of [-1, 1]) {
      const furniture = new Container();
      const x = point.x + direction * (width * 0.39),
        y = point.y + height * 0.22;
      stamp(furniture, art.tile(direction === -1 ? 34 : 36, 10, 1, 2), x - 12, y - 44);
      stamp(furniture, art.tile(8, 16, 1, 3), x - direction * 29 - 12, y - 65);
      stamp(furniture, art.tile(17, 13), x - direction * 54, y - 12);
      depthItems.push({ depth: y, node: furniture });
    }
    const label = new Text({
      text: location.name.toUpperCase(),
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.3,
        fill: 0xf7f6e9,
      },
    });
    label.anchor.set(0.5, 0);
    label.position.set(point.x, point.y + height * 0.4 + 4);
    const count = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0xeff4e6 },
    });
    count.anchor.set(0.5, 0);
    count.position.set(label.x, label.y + 20);
    places.push({ location, point, top: point.y + building.top * fit - 7, label, count });
    // A quiet woodland edge makes the playable city boundary legible.
  }
  for (let i = 0; i < 18; i++) {
    const hash = hashAgentId(`town-edge:${i}`),
      x = left + 24 + i * 69;
    const node = new Container();
    stamp(node, art.tile(hash % 2 ? 34 : 36, 10, 1, 2), x, top - 22 - (hash % 11));
    depthItems.push({ depth: top + 40, node });
  }
  depthItems.sort((a, b) => a.depth - b.depth).forEach((item) => root.addChild(item.node));
  const labels = new Container();
  for (const place of places) {
    const background = new Graphics()
      .roundRect(
        place.label.x - place.label.width / 2 - 12,
        place.label.y - 6,
        place.label.width + 24,
        44,
        5,
      )
      .fill({ color: 0x344e40, alpha: 0.88 });
    labels.addChild(background, place.label, place.count);
  }
  return { root, labels, places, network, scenery, water };
}

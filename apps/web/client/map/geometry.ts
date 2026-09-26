import type { Point, Town, Citizen } from '../model';
export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 800;
/** The city atlas uses an orthogonal RPG perspective; domain coordinates stay normalized. */
export const project = ({ x, y }: Point): Point => ({
  x: (x - 0.5) * WORLD_WIDTH,
  y: (y - 0.5) * WORLD_HEIGHT,
});
export const unproject = ({ x, y }: Point): Point => ({
  x: x / WORLD_WIDTH + 0.5,
  y: y / WORLD_HEIGHT + 0.5,
});
export function corners(rect: Point & { width: number; height: number }): Point[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([dx = 0, dy = 0]) =>
    project({ x: rect.x + (dx * rect.width) / 2, y: rect.y + (dy * rect.height) / 2 }),
  );
}
export function populationGroups(town: Town): Map<string, Citizen[]> {
  const result = new Map<string, Citizen[]>();
  for (const citizen of Object.values(town.agents)) {
    const key = town.transitByAgent[citizen.agentId] ? '@transit' : citizen.locationId;
    const group = result.get(key) ?? [];
    group.push(citizen);
    result.set(key, group);
  }
  return result;
}
export const layoutKey = (town: Town): string =>
  JSON.stringify([
    Object.values(town.locations),
    town.weather.current === 'snowy',
    town.regionalLandValues,
  ]);

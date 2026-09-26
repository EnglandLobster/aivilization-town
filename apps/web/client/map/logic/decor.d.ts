import type { RoadNetwork } from './roads';
export type WaterRegion = {
  regionId: string;
  rect: { x: number; y: number; width: number; height: number };
};
export function computeWaterRegions(locations: Record<string, unknown>): WaterRegion[];
export function computeScenery(
  locations: Record<string, unknown>,
  network: RoadNetwork,
  water: WaterRegion[],
): {
  items: { type: string; x: number; y: number; scale: number; tone: number }[];
  lampposts: { x: number; y: number }[];
};

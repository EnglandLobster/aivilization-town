export type Daytime = {
  phase: string;
  phaseProgress: number;
  dayFraction: number;
  darkness: number;
  warmth: number;
  dayIndex: number;
};
export function resolveDaytime(calendar: unknown, nowMs: number): Daytime | null;

export type SimulationTimestamp = number;

export type SimulationClock = {
  readonly now: SimulationTimestamp;
  readonly tickDurationMs: number;
};

export function advanceClock(clock: SimulationClock, deltaMs: number): SimulationClock {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error(`deltaMs must be a non-negative finite number, received ${deltaMs}`);
  }
  return { ...clock, now: clock.now + deltaMs };
}

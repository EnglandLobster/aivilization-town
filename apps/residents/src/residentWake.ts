import type { OpenSocietyRuntime } from '@aivilization/worker';
/** Existing simulation facts only; caller must ensure no active decision may race time advancement. */
export function nextResidentWakeDelta(runtime: OpenSocietyRuntime): number | undefined {
  const now = runtime.state.world.clock.now;
  const future = [
    ...Object.values(runtime.state.residents)
      .filter((r) => runtime.state.world.agents[r.actorId])
      .map((r) => r.nextWakeAt),
    ...Object.values(runtime.state.reminders)
      .filter((r) => !r.done)
      .map((r) => r.at),
    ...Object.values(runtime.state.world.activityTimeByAgent).map((a) => a.availableAt),
  ].filter((at) => Number.isSafeInteger(at) && at > now);
  return future.length ? Math.min(86400000, Math.min(...future) - now) : undefined;
}

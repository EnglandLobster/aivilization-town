import { advanceElapsedPhysiology, type ElapsedPhysiologyInput } from './elapsedPhysiology';
import { advanceElapsedLaborPhysiology } from './residentLabor';
import type { PublicLaborSession } from './publicLabor';

export const PUBLIC_LABOR_BODY_VERSION = 'resident-public-labor-body-v1';
export type PublicLaborBodyPolicy = Pick<ElapsedPhysiologyInput, 'decay' | 'deprivation'> & {
  readonly critical: { readonly energy: number; readonly health: number };
};
export type PublicLaborBody = {
  readonly policyVersion: typeof PUBLIC_LABOR_BODY_VERSION;
  readonly sessionId: string;
  readonly from: number;
  readonly until: number;
  readonly workedMs: number;
  readonly before: ElapsedPhysiologyInput['previous'];
  readonly after: ElapsedPhysiologyInput['previous'];
  readonly physicallyEnded: boolean;
};
/** One effort integral until the real physical boundary; the rest of the interval is passive time. */
export function publicLaborBody(input: {
  session: PublicLaborSession;
  policy: PublicLaborBodyPolicy;
  previous: ElapsedPhysiologyInput['previous'];
  from: number;
  until: number;
  available: boolean;
}): PublicLaborBody {
  const { session: s, policy: p, previous, from, until } = input;
  if (
    s.status !== 'active' ||
    s.settledAt !== from ||
    ![from, until].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    until <= from ||
    ![p.critical.energy, p.critical.health].every((n) => Number.isFinite(n) && n >= 0)
  )
    throw Error('invalid-public-labor-body-interval');
  const window = Math.max(0, Math.min(until, s.until) - from);
  const advance = (elapsedMs: number) =>
    advanceElapsedLaborPhysiology({ previous, elapsedMs, ...p, labor: s.terms }).next;
  const budget = previous.energy - p.critical.energy,
    rate = (p.decay.energyPerHour + s.terms.energyCostPerHour) / 3600000;
  const energyTime = rate === 0 ? window : budget > 0 ? budget / rate : 0;
  // A tiny positive budget left by prior floating operations must allow the same
  // final whole millisecond as an unsplit interval; zero budget never gains time.
  const roundedTime =
    budget > 0
      ? Math.floor(energyTime + Math.max(1e-8, Math.abs(energyTime) * 8 * Number.EPSILON))
      : 0;
  let low = 0,
    high =
      input.available && budget > 0 && previous.health > p.critical.health
        ? Math.min(window, roundedTime)
        : 0;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (advance(middle).health > p.critical.health) low = middle;
    else high = middle - 1;
  }
  const workedMs = low,
    worked = advance(workedMs),
    after = advanceElapsedPhysiology({
      previous: worked,
      elapsedMs: until - from - workedMs,
      decay: p.decay,
      ...(p.deprivation ? { deprivation: p.deprivation } : {}),
    }).next;
  return {
    policyVersion: PUBLIC_LABOR_BODY_VERSION,
    sessionId: s.id,
    from,
    until,
    workedMs,
    before: previous,
    after,
    physicallyEnded:
      input.available &&
      (workedMs < window ||
        (from + workedMs < s.until &&
          (energyTime <= workedMs + 1e-8 || advance(workedMs + 1).health <= p.critical.health))),
  };
}

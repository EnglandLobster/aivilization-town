import { expireCapitalAgreements } from '@aivilization/enterprise';
import { capitalCommit } from './capitalSettlement';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
/** Expiry preserves its actual boundary even when the simulation skips several cadences. */
export function advanceResidentCapital(input: {
  projection: WorldProjection;
  at: number;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): readonly WorldEvent[] {
  let w = input.projection;
  const events: WorldEvent[] = [];
  if (!w.capitalAgreements) return events;
  const due = Object.values(w.enterprises)
    .flatMap((e) =>
      Object.values(e.capital?.agreements ?? {})
        .filter((a) => a.status === 'proposed')
        .map((a) => ({
          enterpriseId: e.enterpriseId,
          id: a.id,
          at: Math.min(
            a.expiresAt,
            ...Object.values(e.capital!.agreements)
              .filter((b) => b.status === 'executed' && b.equityVersion >= a.equityVersion)
              .map((b) => b.endedAt!),
          ),
        })),
    )
    .filter((a) => a.at <= input.at)
    .sort(
      (a, b) =>
        a.at - b.at ||
        a.enterpriseId.localeCompare(b.enterpriseId, 'en') ||
        a.id.localeCompare(b.id, 'en'),
    );
  for (const item of due) {
    const capital = w.enterprises[item.enterpriseId]!.capital!;
    const event = expireCapitalAgreements(capital, item.at).find((e) => e.agreement.id === item.id);
    if (!event) continue;
    const d = capitalCommit({
      projection: w,
      actorId: 'system',
      enterpriseId: item.enterpriseId,
      requestId: `${input.requestId}-${events.length}`,
      simulationId: input.simulationId,
      nextSequence: input.nextSequence + events.length,
      at: item.at,
      invocation: { kind: 'automatic' },
      events: [{ type: 'EnterpriseCapitalAgreementCommitted', event }],
    });
    if (!d.accepted) throw Error(`protected-capital-refund-failed:${d.reason}`);
    for (const e of d.events) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  }
  return events;
}

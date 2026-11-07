import { type CollectiveEvent, type CollectivesState } from './collectiveModel';
import { settleCollectiveDecision } from './collectives';

export function nextCollectiveBoundary(s: CollectivesState | undefined): number | undefined {
  if (!s) return undefined;
  const times = [
    ...Object.values(s.charters)
      .filter((c) => c.status === 'pending')
      .map((c) => c.expiresAt),
    ...Object.values(s.decisions)
      .filter(
        (d) => d.status === 'open' || (d.status === 'passed' && d.action.kind !== 'statement'),
      )
      .map((d) => (d.status === 'open' ? d.closesAt : d.executeBefore)),
  ];
  return times.length ? times.reduce((a, b) => Math.min(a, b), Infinity) : undefined;
}
export function advanceCollectives(s: CollectivesState, at: number): CollectiveEvent[] {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error('invalid-collective-time');
  const changes: { at: number; id: string; events: CollectiveEvent[] }[] = [];
  for (const c of Object.values(s.charters))
    if (c.status === 'pending' && c.expiresAt <= at)
      changes.push({
        at: c.expiresAt,
        id: c.id,
        events: [
          {
            type: 'CollectiveCharterChanged',
            charter: { ...c, status: 'expired', revision: c.revision + 1 },
          },
        ],
      });
  for (const original of Object.values(s.decisions)) {
    const events: CollectiveEvent[] = [];
    let d = original;
    if (d.status === 'open' && d.closesAt <= at) {
      const settled = settleCollectiveDecision(d, d.closesAt)!;
      d = settled;
      events.push({ type: 'CollectiveDecisionChanged', decision: d });
    }
    if (d.status === 'passed' && d.action.kind !== 'statement' && d.executeBefore <= at) {
      d = { ...d, status: 'expired', revision: d.revision + 1 };
      events.push({ type: 'CollectiveDecisionChanged', decision: d });
    }
    if (events.length)
      changes.push({
        at: original.status === 'open' ? original.closesAt : original.executeBefore,
        id: original.id,
        events,
      });
  }
  return changes
    .flatMap((c) =>
      c.events.map((event) => ({
        event,
        id: c.id,
        at:
          event.type === 'CollectiveDecisionChanged' && event.decision.status === 'expired'
            ? event.decision.executeBefore
            : c.at,
      })),
    )
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => c.event);
}

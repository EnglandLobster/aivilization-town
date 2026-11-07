import { canReadGroup, communicationBlocked } from '@aivilization/information';
import { canReadGroupInvitation } from './groupInvitationAccess';
import type { OpenSocietyState } from './types';
export function residentLifeInbox(s: OpenSocietyState, actorId: string, limit: number) {
  const items: {
    kind: string;
    id: string;
    at: number;
    readWith: string;
    section?: 'decisions' | 'appointments' | 'messages';
    dueAt?: number;
  }[] = [];
  for (const i of Object.values(s.communication?.invitations ?? {}))
    if (i.status === 'pending' && canReadGroupInvitation(s, i, actorId))
      items.push({
        kind: 'group-invitation',
        id: i.id,
        at: i.at,
        readWith: 'town groups invitations',
      });
  for (const m of Object.values(s.communication?.messages ?? {}))
    if (
      s.communication &&
      m.authorId !== actorId &&
      !s.communication.readMessageIds?.[actorId]?.includes(m.id) &&
      canReadGroup(s.communication, actorId, m.groupId) &&
      !communicationBlocked(s.communication, actorId, m.authorId)
    )
      items.push({
        kind: 'group-message',
        id: m.id,
        at: m.at,
        readWith: `town groups messages --group-id ${m.groupId}`,
      });
  for (const p of Object.values(s.collaboration?.proposals ?? {}))
    if (p.status === 'open' && p.participants.includes(actorId) && p.consents[actorId] !== true)
      items.push({
        kind: 'proposal',
        id: p.id,
        at: p.at,
        dueAt: p.expiresAt,
        readWith: `town proposals read --id ${p.id}`,
      });
  for (const o of Object.values(s.world.residentCommerce?.orders ?? {}))
    if (
      [o.buyerId, o.sellerId].includes(actorId) &&
      !['completed', 'cancelled', 'refunded', 'settled'].includes(o.status)
    )
      items.push({ kind: 'order', id: o.id, at: o.at, readWith: `town orders read --id ${o.id}` });
  for (const r of Object.values(s.world.residentCommerce?.requests ?? {}))
    if (!r.closed && r.payers.includes(actorId) && !r.paidBy.includes(actorId))
      items.push({
        kind: 'payment-request',
        id: r.id,
        at: r.at,
        readWith: `town payments read --id ${r.id}`,
      });
  const sections = ['decisions', 'appointments', 'messages'] as const;
  const queues = sections.map((section) =>
    items
      .map((item) => ({
        ...item,
        section:
          item.section ??
          (item.kind === 'group-message' ? ('messages' as const) : ('decisions' as const)),
      }))
      .filter((item) => item.section === section)
      .sort(
        (a, b) =>
          (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) ||
          b.at - a.at ||
          a.kind.localeCompare(b.kind, 'en') ||
          a.id.localeCompare(b.id, 'en'),
      ),
  );
  const selected: typeof items = [];
  // Round-robin reserves room for each nonempty channel without a subjective importance score.
  for (let row = 0; selected.length < Math.min(6, limit) && row < items.length; row++) {
    for (const queue of queues) {
      if (selected.length >= Math.min(6, limit)) break;
      if (queue[row]) selected.push(queue[row]!);
    }
  }
  return {
    version: 'resident-attention-v2',
    items: selected,
    total: items.length,
    sections: sections.map((section, i) => ({
      section,
      total: queues[i]!.length,
      shown: selected.filter((item) => item.section === section).length,
    })),
    note: 'Separate bounded channels for pending decisions, accepted appointments and unread group messages. Deadlines are factual, not obligations. You may ignore or defer; query the relevant CLI for omitted items.',
  };
}

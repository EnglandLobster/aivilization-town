import { mobilityInbox } from './mobilityTools';
import { canReadGroup, communicationBlocked } from '@aivilization/information';
import type { OpenSocietyState } from './types';
export function residentLifeInbox(s: OpenSocietyState, actorId: string, limit: number) {
  const items: {
    kind: string;
    id: string;
    at: number;
    readWith: string;
    section?: 'decisions' | 'appointments' | 'messages';
    dueAt?: number;
  }[] = mobilityInbox(s, actorId);
  for (const i of Object.values(s.communication?.invitations ?? {}))
    if (
      i.status === 'pending' &&
      (i.residentId === actorId || s.communication?.groups[i.groupId]?.ownerId === actorId)
    )
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
  for (const b of Object.values(s.services?.bookings ?? {}))
    if (
      !['cancelled', 'expired', 'completed', 'ended'].includes(b.status) &&
      (b.residentId === actorId ||
        s.services?.services[s.services.slots[b.slotId]!.serviceId]?.ownerId === actorId)
    )
      items.push({
        kind: 'booking',
        id: b.id,
        at: b.at,
        section: b.status === 'requested' ? 'decisions' : 'appointments',
        dueAt: s.services!.slots[b.slotId]!.start,
        readWith: `town bookings read --id ${b.id}`,
      });
  for (const l of Object.values(s.life?.households.links ?? {}))
    if (l.status === 'proposed' && l.partnerId === actorId)
      items.push({
        kind: 'household-proposal',
        id: l.id,
        at: l.at,
        readWith: 'town households list',
      });
  for (const t of Object.values(s.life?.care.tasks ?? {}))
    if (
      !['completed', 'cancelled'].includes(t.status) &&
      [t.providerId, t.recipientId].includes(actorId)
    )
      items.push({ kind: 'care-task', id: t.id, at: t.at, readWith: 'town care list' });
  for (const l of Object.values(s.world.residentLeases?.leases ?? {}))
    if (l.status !== 'ended' && [l.hostId, l.tenantId].includes(actorId))
      items.push({ kind: 'lease', id: l.id, at: l.at, readWith: 'town leases list' });
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

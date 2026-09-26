export const RESIDENT_CARE_POLICY = {
  version: 'resident-care-v1',
  maxDurationMs: 86400000,
  maxText: 8000,
} as const;
export type CareTask = {
  id: string;
  recipientId: string;
  providerId: string;
  locationId: string;
  description: string;
  durationMs: number;
  revision: number;
  status: 'requested' | 'accepted' | 'active' | 'completed' | 'cancelled';
  at: number;
  startedAt?: number;
  endsAt?: number;
};
export type CareState = { version: 'resident-care-v1'; tasks: Readonly<Record<string, CareTask>> };
export type CareEvent = { type: 'CareTaskChanged'; task: CareTask };
export type CareCommand =
  | {
      type: 'request';
      id: string;
      providerId: string;
      locationId: string;
      description: string;
      durationMs: number;
    }
  | { type: 'accept' | 'start' | 'cancel'; id: string; expectedRevision: number };
export function emptyCareState(): CareState {
  return { version: 'resident-care-v1', tasks: {} };
}
export function decideCare(
  s: CareState,
  a: string,
  at: number,
  c: CareCommand,
  p: {
    exists: (id: string) => boolean;
    locationExists: (id: string) => boolean;
    presentAndIdle: (id: string, location: string) => boolean;
  },
):
  | {
      accepted: true;
      events: readonly CareEvent[];
      participation?: { participants: readonly string[]; locationId: string; until: number };
    }
  | { accepted: false; reason: string } {
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!p.exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (c.type === 'request') {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.id) ||
      Object.hasOwn(s.tasks, c.id) ||
      !p.exists(c.providerId) ||
      a === c.providerId ||
      !p.locationExists(c.locationId) ||
      !c.description.trim() ||
      c.description.length > RESIDENT_CARE_POLICY.maxText ||
      !Number.isSafeInteger(c.durationMs) ||
      c.durationMs < 1 ||
      c.durationMs > RESIDENT_CARE_POLICY.maxDurationMs
    )
      return no('invalid-care-request');
    return {
      accepted: true,
      events: [
        {
          type: 'CareTaskChanged',
          task: {
            id: c.id,
            recipientId: a,
            providerId: c.providerId,
            locationId: c.locationId,
            description: c.description,
            durationMs: c.durationMs,
            revision: 1,
            status: 'requested',
            at,
          },
        },
      ],
    };
  }
  const t = s.tasks[c.id];
  if (!t || ![t.recipientId, t.providerId].includes(a)) return no('care-not-found');
  if (t.revision !== c.expectedRevision) return no('revision-conflict');
  if (c.type === 'accept') {
    if (t.providerId !== a || t.status !== 'requested') return no('provider-consent-required');
    return {
      accepted: true,
      events: [
        { type: 'CareTaskChanged', task: { ...t, status: 'accepted', revision: t.revision + 1 } },
      ],
    };
  }
  if (c.type === 'cancel') {
    if (!['requested', 'accepted'].includes(t.status)) return no('care-cannot-cancel');
    return {
      accepted: true,
      events: [
        { type: 'CareTaskChanged', task: { ...t, status: 'cancelled', revision: t.revision + 1 } },
      ],
    };
  }
  if (
    t.providerId !== a ||
    t.status !== 'accepted' ||
    ![t.providerId, t.recipientId].every((id) => p.presentAndIdle(id, t.locationId))
  )
    return no('care-requires-consent-place-and-idle');
  const until = at + t.durationMs;
  return {
    accepted: true,
    events: [
      {
        type: 'CareTaskChanged',
        task: { ...t, status: 'active', startedAt: at, endsAt: until, revision: t.revision + 1 },
      },
    ],
    participation: { participants: [t.providerId, t.recipientId], locationId: t.locationId, until },
  };
}
export function advanceCare(s: CareState, at: number): CareEvent[] {
  return Object.values(s.tasks)
    .filter((t) => t.status === 'active' && t.endsAt! <= at)
    .sort((a, b) => a.endsAt! - b.endsAt! || a.id.localeCompare(b.id, 'en'))
    .map((t) => ({
      type: 'CareTaskChanged',
      task: { ...t, status: 'completed', revision: t.revision + 1 },
    }));
}
export function applyCareEvent(s: CareState, e: CareEvent): CareState {
  if (e.task.revision !== (s.tasks[e.task.id]?.revision ?? 0) + 1)
    throw new Error('care-revision-gap');
  return { ...s, tasks: { ...s.tasks, [e.task.id]: e.task } };
}

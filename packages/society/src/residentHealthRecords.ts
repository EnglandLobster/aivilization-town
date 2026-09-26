export const RESIDENT_HEALTH_RECORD_POLICY = {
  version: 'resident-health-records-v1',
  maxText: 8000,
} as const;
export type HealthRecord = {
  id: string;
  patientId: string;
  authorId: string;
  kind: 'note' | 'treatment' | 'medication' | 'follow-up';
  content: string;
  at: number;
  sourceEventIds: readonly string[];
};
export type HealthRecordsState = {
  version: 'resident-health-records-v1';
  grants: Readonly<Record<string, readonly string[]>>;
  records: Readonly<Record<string, HealthRecord>>;
};
export type HealthRecordEvent =
  | { type: 'HealthAccessChanged'; patientId: string; readers: readonly string[] }
  | { type: 'HealthRecordAdded'; record: HealthRecord };
export type HealthRecordCommand =
  | { type: 'grant' | 'revoke'; targetId: string }
  | {
      type: 'record';
      id: string;
      patientId: string;
      kind: HealthRecord['kind'];
      content: string;
      sourceEventIds: readonly string[];
    };
export function emptyHealthRecordsState(): HealthRecordsState {
  return { version: 'resident-health-records-v1', grants: {}, records: {} };
}
export function canReadHealth(s: HealthRecordsState, a: string, patientId: string) {
  return a === patientId || (s.grants[patientId]?.includes(a) ?? false);
}
export function decideHealthRecord(
  s: HealthRecordsState,
  a: string,
  at: number,
  c: HealthRecordCommand,
  p: {
    exists: (id: string) => boolean;
    ownsSource: (patientId: string, eventId: string) => boolean;
  },
): { accepted: true; events: readonly HealthRecordEvent[] } | { accepted: false; reason: string } {
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!p.exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (c.type === 'grant' || c.type === 'revoke') {
    if (!p.exists(c.targetId) || c.targetId === a) return no('invalid-health-reader');
    const readers = new Set(s.grants[a] ?? []);
    if (c.type === 'grant') readers.add(c.targetId);
    else readers.delete(c.targetId);
    return {
      accepted: true,
      events: [{ type: 'HealthAccessChanged', patientId: a, readers: [...readers].sort() }],
    };
  }
  if (!('patientId' in c)) return no('invalid-command');
  if (!p.exists(c.patientId) || !canReadHealth(s, a, c.patientId))
    return no('patient-authorization-required');
  if (
    !['note', 'treatment', 'medication', 'follow-up'].includes(c.kind) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.id) ||
    Object.hasOwn(s.records, c.id) ||
    !c.content.trim() ||
    c.content.length > RESIDENT_HEALTH_RECORD_POLICY.maxText ||
    !c.sourceEventIds.every((id) => p.ownsSource(c.patientId, id))
  )
    return no('invalid-record-or-evidence');
  if (c.kind === 'treatment' && c.sourceEventIds.length === 0)
    return no('treatment-world-evidence-required');
  return {
    accepted: true,
    events: [
      {
        type: 'HealthRecordAdded',
        record: {
          id: c.id,
          patientId: c.patientId,
          authorId: a,
          kind: c.kind,
          content: c.content,
          sourceEventIds: c.sourceEventIds,
          at,
        },
      },
    ],
  };
}
export function applyHealthRecordEvent(
  s: HealthRecordsState,
  e: HealthRecordEvent,
): HealthRecordsState {
  return e.type === 'HealthAccessChanged'
    ? { ...s, grants: { ...s.grants, [e.patientId]: e.readers } }
    : { ...s, records: { ...s.records, [e.record.id]: e.record } };
}

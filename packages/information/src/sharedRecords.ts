import {
  personallyControls,
  resourceAdministration,
  revisedResourceControl,
  type ResourceControl,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
/** Resident-authored records are claims, never a second economic or physical ledger. */
import { validInformationId } from './model';

export const SHARED_RECORDS_POLICY = {
  version: 'shared-records-v1',
  maxRegistersPerOwner: 20,
  maxRecords: 1000,
  maxFields: 16,
  maxText: 2000,
  maxValuesChars: 8000,
  maxMembers: 30,
} as const;
export type SharedRecordsPolicy = { readonly version: 'shared-records-v1' } & {
  readonly [K in Exclude<keyof typeof SHARED_RECORDS_POLICY, 'version'>]: number;
};
export type RecordFields = Readonly<Record<string, 'string' | 'number' | 'boolean'>>;
export type RecordValues = Readonly<Record<string, string | number | boolean>>;
export type SharedRegister = {
  readonly control?: ResourceControl;
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: 'public' | 'private';
  readonly readers: readonly string[];
  readonly editors: readonly string[];
  readonly fields: RecordFields;
  readonly revision: number;
  readonly at: number;
  readonly successorId?: string;
};
export type SharedRecord = {
  readonly registerId: string;
  readonly key: string;
  readonly values: RecordValues;
  readonly revision: number;
  readonly createdBy: string;
  readonly editedBy: string;
  readonly authorityId: string;
  readonly deleted: boolean;
  readonly at: number;
};
export type SharedRecordsState = {
  readonly policy: SharedRecordsPolicy;
  readonly registers: Readonly<Record<string, SharedRegister>>;
  readonly registerHistory: Readonly<Record<string, readonly SharedRegister[]>>;
  readonly records: Readonly<Record<string, SharedRecord>>;
  readonly history: Readonly<Record<string, readonly SharedRecord[]>>;
  /** Optional derived index; legacy states can rebuild it from preserved records. */
  readonly recordKeysByRegister?: Readonly<Record<string, readonly string[]>>;
};
export type SharedRecordsEvent =
  | { readonly type: 'SharedRecordsEnabled'; readonly policy: SharedRecordsPolicy }
  | { readonly type: 'SharedRegisterChanged'; readonly register: SharedRegister }
  | { readonly type: 'SharedRecordWritten'; readonly record: SharedRecord };
export type SharedRecordsCommand =
  | {
      type: 'registers.create';
      id: string;
      title: string;
      visibility: 'public' | 'private';
      readers: readonly string[];
      editors: readonly string[];
      fields: Readonly<Record<string, unknown>>;
    }
  | {
      type: 'registers.configure';
      id: string;
      expectedRevision: number;
      visibility: 'public' | 'private';
      readers: readonly string[];
      editors: readonly string[];
    }
  | { type: 'registers.nominate'; id: string; expectedRevision: number; successorId: string }
  | { type: 'registers.accept'; id: string; expectedRevision: number }
  | {
      type: 'records.put';
      registerId: string;
      key: string;
      expectedRevision: number;
      values: Readonly<Record<string, unknown>>;
    }
  | { type: 'records.delete'; registerId: string; key: string; expectedRevision: number };

export function assertSharedRecordsPolicy(p: SharedRecordsPolicy): void {
  if (
    p.version !== 'shared-records-v1' ||
    Object.keys(SHARED_RECORDS_POLICY).some(
      (k) =>
        k !== 'version' &&
        (!Number.isSafeInteger(p[k as keyof SharedRecordsPolicy]) ||
          Number(p[k as keyof SharedRecordsPolicy]) < 1),
    )
  )
    throw new Error('invalid-shared-records-policy');
}
export function emptySharedRecordsState(
  policy: SharedRecordsPolicy = SHARED_RECORDS_POLICY,
): SharedRecordsState {
  assertSharedRecordsPolicy(policy);
  return { policy, registers: {}, registerHistory: {}, records: {}, history: {} };
}
export const sharedRecordKey = (registerId: string, key: string) => `${registerId}/${key}`;
export function sharedRegisterRecords(
  s: SharedRecordsState,
  registerId: string,
): readonly SharedRecord[] {
  const keys = s.recordKeysByRegister?.[registerId];
  return keys
    ? keys.map((key) => s.records[key]!)
    : Object.values(s.records).filter((r) => r.registerId === registerId);
}
export const canEditRegister = (r: SharedRegister, actor: string) =>
  personallyControls(r, actor) || r.editors.includes(actor);
export const canReadRegister = (r: SharedRegister, actor: string) =>
  r.visibility === 'public' ||
  canEditRegister(r, actor) ||
  r.readers.includes(actor) ||
  r.successorId === actor;
export function decideSharedRecords(input: {
  state: SharedRecordsState;
  actorId: string;
  /** Only an authenticated application adapter may supply a separately verified authority. */
  authorityId?: string;
  controlAuthorization?: ControlAuthorizationPort;
  at: number;
  command: SharedRecordsCommand;
  exists: (id: string) => boolean;
}):
  | { accepted: true; events: readonly SharedRecordsEvent[] }
  | { accepted: false; reason: string } {
  const { state: s, actorId: actor, at, command: c, exists } = input;
  const authority = input.authorityId ?? actor;
  const no = (reason: string) => ({ accepted: false as const, reason });
  const yes = (event: SharedRecordsEvent) => ({ accepted: true as const, events: [event] });
  assertSharedRecordsPolicy(s.policy);
  if (!exists(actor) || !exists(authority) || !Number.isSafeInteger(at) || at < 0)
    return no('invalid-actor-or-time');
  const members = (ids: readonly string[]) =>
    ids.length <= s.policy.maxMembers &&
    new Set(ids).size === ids.length &&
    ids.every((id) => validInformationId(id) && exists(id));
  if (c.type === 'registers.create') {
    if (actor !== authority) return no('direct-authority-required');
    if (!validInformationId(c.id) || Object.hasOwn(s.registers, c.id))
      return no('invalid-register-id');
    if (
      Object.values(s.registers).filter((r) => personallyControls(r, actor)).length >=
      s.policy.maxRegistersPerOwner
    )
      return no('register-quota');
    if (
      !c.title.trim() ||
      c.title.length > 120 ||
      !['public', 'private'].includes(c.visibility) ||
      !members(c.readers) ||
      !members(c.editors)
    )
      return no('invalid-register-settings');
    const fields = Object.entries(c.fields);
    if (
      fields.length < 1 ||
      fields.length > s.policy.maxFields ||
      fields.some(
        ([k, v]) =>
          !validInformationId(k) ||
          typeof v !== 'string' ||
          !['string', 'number', 'boolean'].includes(v),
      )
    )
      return no('invalid-record-schema');
    // Every field value was checked against the complete, closed schema type above.
    const schema = Object.fromEntries(fields) as RecordFields;
    return yes({
      type: 'SharedRegisterChanged',
      register: {
        id: c.id,
        ownerId: actor,
        title: c.title,
        visibility: c.visibility,
        readers: [...c.readers],
        editors: [...c.editors],
        fields: schema,
        revision: 1,
        at,
      },
    });
  }
  const registerId = 'registerId' in c ? c.registerId : c.id;
  const r = Object.hasOwn(s.registers, registerId) ? s.registers[registerId] : undefined;
  const admin =
    r && actor === authority
      ? resourceAdministration(r, actor, input.controlAuthorization)
      : undefined;
  if (!r || (!canReadRegister(r, authority) && !(c.type === 'registers.configure' && admin)))
    return no('record-not-found');
  if (c.type === 'records.put' || c.type === 'records.delete') {
    if (!canEditRegister(r, authority)) return no('record-write-forbidden');
    if (!validInformationId(c.key)) return no('invalid-record-key');
    const key = sharedRecordKey(r.id, c.key),
      old = s.records[key];
    if (c.expectedRevision !== (old?.revision ?? 0)) return no('revision-conflict');
    if (c.type === 'records.delete' && (!old || old.deleted)) return no('record-not-found');
    if (
      !old &&
      Object.values(s.records).filter((v) => v.registerId === r.id).length >= s.policy.maxRecords
    )
      return no('record-quota');
    let values: RecordValues = old?.values ?? {};
    if (c.type === 'records.put') {
      if (
        Object.keys(c.values).length !== Object.keys(r.fields).length ||
        Object.entries(c.values).some(
          ([k, v]) =>
            !Object.hasOwn(r.fields, k) ||
            typeof v !== r.fields[k] ||
            (typeof v === 'number' && !Number.isFinite(v)) ||
            (typeof v === 'string' && v.length > s.policy.maxText),
        ) ||
        JSON.stringify(c.values).length > s.policy.maxValuesChars
      )
        return no('invalid-record-values');
      // Flat scalar fields, key set, types, and finite bounds were checked above.
      values = { ...c.values } as RecordValues;
    }
    return yes({
      type: 'SharedRecordWritten',
      record: {
        registerId: r.id,
        key: c.key,
        values,
        revision: (old?.revision ?? 0) + 1,
        createdBy: old?.createdBy ?? actor,
        editedBy: actor,
        authorityId: authority,
        deleted: c.type === 'records.delete',
        at,
      },
    });
  }
  if (actor !== authority) return no('direct-authority-required');
  if (c.expectedRevision !== r.revision) return no('revision-conflict');
  if (c.type === 'registers.accept') {
    if (r.control) return no('resource-control-offer-required');
    if (r.successorId !== actor) return no('nominated-owner-required');
    if (
      Object.values(s.registers).filter((v) => personallyControls(v, actor)).length >=
      s.policy.maxRegistersPerOwner
    )
      return no('register-quota');
    const { successorId: _successor, ...base } = r;
    void _successor;
    return yes({
      type: 'SharedRegisterChanged',
      register: { ...base, ownerId: actor, revision: r.revision + 1, at },
    });
  }
  if (!admin) return no('register-owner-required');
  if (c.type === 'registers.nominate') {
    if (r.control) return no('resource-control-offer-required');
    if (!exists(c.successorId) || c.successorId === actor) return no('invalid-successor');
    return yes({
      type: 'SharedRegisterChanged',
      register: { ...r, successorId: c.successorId, revision: r.revision + 1, at },
    });
  }
  if (!['public', 'private'].includes(c.visibility) || !members(c.readers) || !members(c.editors))
    return no('invalid-register-settings');
  // Changing ACL cancels a pending handover; acceptance must refer to the settings actually offered.
  const { successorId: _successor, ...base } = r;
  void _successor;
  return yes({
    type: 'SharedRegisterChanged',
    register: {
      ...base,
      ...(r.control ? { control: revisedResourceControl(r, admin, at)! } : {}),
      visibility: c.visibility,
      readers: [...c.readers],
      editors: [...c.editors],
      revision: r.revision + 1,
      at,
    },
  });
}
export function applySharedRecordsEvent(
  state: SharedRecordsState | undefined,
  e: SharedRecordsEvent,
): SharedRecordsState {
  if (e.type === 'SharedRecordsEnabled') {
    if (state) throw new Error('shared-records-already-enabled');
    return emptySharedRecordsState(e.policy);
  }
  if (!state) throw new Error('shared-records-not-enabled');
  if (e.type === 'SharedRegisterChanged') {
    const r = e.register;
    if (r.revision !== (state.registers[r.id]?.revision ?? 0) + 1)
      throw new Error('register-revision-gap');
    return {
      ...state,
      registers: { ...state.registers, [r.id]: r },
      registerHistory: {
        ...state.registerHistory,
        [r.id]: [...(state.registerHistory[r.id] ?? []), r],
      },
    };
  }
  const r = e.record,
    key = sharedRecordKey(r.registerId, r.key);
  if (r.revision !== (state.records[key]?.revision ?? 0) + 1)
    throw new Error('record-revision-gap');
  return {
    ...state,
    records: { ...state.records, [key]: r },
    recordKeysByRegister: {
      ...state.recordKeysByRegister,
      [r.registerId]: [
        ...sharedRegisterRecords(state, r.registerId).map((row) =>
          sharedRecordKey(row.registerId, row.key),
        ),
        ...(state.records[key] ? [] : [key]),
      ],
    },
    history: { ...state.history, [key]: [...(state.history[key] ?? []), r] },
  };
}

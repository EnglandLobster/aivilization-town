import {
  canReadRegister,
  decideSharedRecords,
  sharedRecordKey,
  type SharedRecordsCommand,
} from '@aivilization/information';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { digest } from './journal';
import { ToolRefusal, stringArg, stringArrayArg, numberArg, pageItems } from './arguments';

export function objectArg(
  args: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> {
  const v = args[name];
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    throw new ToolRefusal(`invalid-object:${name}`);
  return v as Readonly<Record<string, unknown>>;
}
export function executeSharedRecordTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorityId = actorId,
): ToolExecution {
  const s = state.sharedRecords;
  if (!s) throw new ToolRefusal('shared-records-not-enabled');
  const id = stringArg(args, 'id'),
    registerId = stringArg(args, 'registerId');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const sorted = Object.values(s.registers)
    .filter((r) => canReadRegister(r, actorId))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (name === 'registers.list')
    return result(
      pageItems(
        sorted.map(({ fields, ...r }) => ({ ...r, fieldCount: Object.keys(fields).length })),
        args,
      ),
    );
  if (name === 'registers.read') {
    const r = sorted.find((v) => v.id === id);
    if (!r) throw new ToolRefusal('record-not-found');
    return result({ ...r, provenance: 'resident-defined-schema' });
  }
  if (['records.read', 'records.history', 'records.list'].includes(name)) {
    if (!sorted.some((r) => r.id === registerId)) throw new ToolRefusal('record-not-found');
    if (name === 'records.list')
      return result(
        pageItems(
          Object.values(s.records)
            .filter((v) => v.registerId === registerId && !v.deleted)
            .sort((a, b) => a.key.localeCompare(b.key, 'en'))
            .map(({ values, ...r }) => ({
              ...r,
              fields: Object.keys(values),
              provenance: 'resident-claim',
            })),
          args,
        ),
      );
    const key = sharedRecordKey(registerId, stringArg(args, 'key')),
      record = s.records[key];
    if (!record || (record.deleted && name === 'records.read'))
      throw new ToolRefusal('record-not-found');
    return result(
      name === 'records.history'
        ? pageItems(s.history[key] ?? [], args)
        : { ...record, provenance: 'resident-claim' },
    );
  }
  const expectedRevision = numberArg(args, 'expectedRevision');
  const acl = {
    visibility: stringArg(args, 'visibility') as 'public' | 'private',
    readers: stringArrayArg(args, 'readers'),
    editors: stringArrayArg(args, 'editors'),
  };
  let command: SharedRecordsCommand;
  if (name === 'registers.create')
    command = {
      type: name,
      id,
      title: stringArg(args, 'title'),
      ...acl,
      fields: objectArg(args, 'fields'),
    };
  else if (name === 'registers.configure') command = { type: name, id, expectedRevision, ...acl };
  else if (name === 'registers.nominate')
    command = { type: name, id, expectedRevision, successorId: stringArg(args, 'successorId') };
  else if (name === 'registers.accept') command = { type: name, id, expectedRevision };
  else if (name === 'records.put' || name === 'records.append')
    command = {
      type: 'records.put',
      registerId,
      key:
        name === 'records.append'
          ? `entry-${digest([actorId, requestId]).slice(0, 32)}`
          : stringArg(args, 'key'),
      expectedRevision: name === 'records.append' ? 0 : expectedRevision,
      values: objectArg(args, 'values'),
    };
  else if (name === 'records.delete')
    command = { type: name, registerId, key: stringArg(args, 'key'), expectedRevision };
  else throw new ToolRefusal('unknown-shared-record-command');
  const d = decideSharedRecords({
    state: s,
    actorId,
    authorityId,
    at: state.world.clock.now,
    command,
    exists: (id) => Object.hasOwn(state.world.agents, id),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: d.events.map((e) =>
      e.type === 'SharedRecordWritten'
        ? { ...e.record, provenance: 'resident-claim' }
        : e.type === 'SharedRegisterChanged'
          ? e.register
          : null,
    ),
    effects: { sharedRecordsEvents: d.events },
  };
}

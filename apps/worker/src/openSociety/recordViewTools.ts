import {
  canReadRecordView,
  decideRecordView,
  evaluateRecordView,
  type RecordViewCommand,
} from '@aivilization/information';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { ToolRefusal, stringArg, numberArg, stringArrayArg, pageItems } from './arguments';
import { objectArg } from './sharedRecordTools';

export function executeRecordViewTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  const s = state.recordViews,
    records = state.sharedRecords;
  if (!s || !records) throw new ToolRefusal('record-views-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const id = stringArg(args, 'id');
  const visible = Object.values(s.views)
    .filter((v) => canReadRecordView(v, actorId, records))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (name === 'views.list')
    return result(
      pageItems(
        visible.map(({ definition, ...v }) => ({
          ...v,
          sourceRegisterId: definition.sourceRegisterId,
          readWith: `town views read --id ${v.id}`,
        })),
        args,
      ),
    );
  if (name === 'views.read' || name === 'views.history') {
    const v = visible.find((v) => v.id === id);
    if (!v) throw new ToolRefusal('view-not-found');
    return result(
      name === 'views.read'
        ? { ...v, provenance: 'resident-defined-computation' }
        : pageItems(
            (s.history[id] ?? []).filter((v) => canReadRecordView(v, actorId, records)),
            args,
          ),
    );
  }
  if (name === 'views.query') {
    const d = evaluateRecordView({
      state: s,
      records,
      actorId,
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
      offset: numberArg(args, 'offset', 0),
      limit: numberArg(args, 'limit', 10),
    });
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return result(d.result);
  }
  let command: RecordViewCommand;
  if (name === 'views.disable')
    command = { type: name, id, expectedRevision: numberArg(args, 'expectedRevision') };
  else if (name === 'views.publish' || name === 'views.revise')
    command = {
      type: name,
      id,
      expectedRevision: name === 'views.publish' ? 0 : numberArg(args, 'expectedRevision'),
      title: stringArg(args, 'title'),
      visibility: stringArg(args, 'visibility') as 'public' | 'private',
      readers: stringArrayArg(args, 'readers'),
      definition: objectArg(args, 'definition'),
    };
  else throw new ToolRefusal('unknown-record-view-command');
  const d = decideRecordView({
    state: s,
    records,
    actorId,
    at: state.world.clock.now,
    command,
    exists: (id) => Object.hasOwn(state.world.agents, id),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: d.events.map((e) => (e.type === 'RecordViewChanged' ? e.view : null)),
    effects: { recordViewEvents: d.events },
  };
}

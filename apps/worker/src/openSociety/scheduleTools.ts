import { validInformationId } from '@aivilization/information';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { numberArg, pageItems, stringArg, ToolRefusal } from './arguments';
export function executeScheduleTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  const resident = state.residents[actorId]!;
  const at = state.world.clock.now;
  if (name === 'schedule.configure') {
    const interval = numberArg(args, 'freeActivityIntervalMs');
    if (!Number.isSafeInteger(interval) || interval < 60_000 || interval > 86_400_000)
      throw new ToolRefusal('invalid-free-activity-interval');
    return {
      data: { freeActivityIntervalMs: interval },
      effects: { residents: [{ ...resident, freeActivityIntervalMs: interval }] },
    };
  }
  if (name === 'schedule.list')
    return {
      data: pageItems(
        Object.values(state.reminders).filter((item) => item.ownerId === actorId),
        args,
      ),
      effects: {},
    };
  if (name === 'schedule.wait') {
    const until = numberArg(args, 'until');
    if (until <= at) throw new ToolRefusal('wait-must-be-in-future');
    const turn =
      resident.activeTurnId === undefined ? undefined : state.turns[resident.activeTurnId];
    if (turn === undefined) throw new ToolRefusal('no-active-turn');
    return {
      data: { status: 'waiting', until },
      effects: {
        residents: [{ ...resident, nextWakeAt: until, wakeReason: 'scheduled-wake' }],
        turns: [
          { ...turn, status: 'waiting', summary: stringArg(args, 'summary'), nextWakeAt: until },
        ],
      },
    };
  }
  const id = stringArg(args, 'id');
  if (!validInformationId(id)) throw new ToolRefusal('invalid-reminder-id');
  const key = `${actorId}:${id}`;
  const existing = state.reminders[key];
  if (name === 'schedule.cancel') {
    if (existing === undefined) throw new ToolRefusal('not-found');
    const reminder = { ...existing, done: true };
    return { data: reminder, effects: { reminders: [reminder] } };
  }
  if (name !== 'schedule.remind') throw new ToolRefusal('unknown-schedule-tool');
  const due = numberArg(args, 'at');
  if (due <= at) throw new ToolRefusal('reminder-must-be-in-future');
  if (existing !== undefined) throw new ToolRefusal('reminder-id-unavailable');
  if (
    Object.values(state.reminders).filter((entry) => entry.ownerId === actorId && !entry.done)
      .length >= 100
  )
    throw new ToolRefusal('reminder-limit');
  const reminder = {
    id: key,
    ownerId: actorId,
    at: due,
    text: stringArg(args, 'text'),
    done: false,
  };
  return { data: reminder, effects: { reminders: [reminder] } };
}

import { validInformationId } from '@aivilization/information';
import type { OpenSocietyState, ResidentActionPlan } from './types';
import type { ToolExecution } from './informationTools';
import { numberArg, pageItems, stringArg, stringArrayArg, ToolRefusal } from './arguments';
import { parseActionPlanStep } from './actionPlans';
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
  if (name === 'schedule.plan') {
    const policy = state.actionPlans;
    if (!policy) throw new ToolRefusal('action-plans-not-enabled');
    const id = stringArg(args, 'id');
    if (!validInformationId(id)) throw new ToolRefusal('invalid-plan-id');
    const commands = stringArrayArg(args, 'steps');
    if (!commands.length || commands.length > policy.maxSteps)
      throw new ToolRefusal('invalid-plan-length');
    const plan: ResidentActionPlan = {
      version: policy.version,
      id,
      note: stringArg(args, 'note'),
      createdAt: at,
      createdRevision: state.revision,
      steps: commands.map((command) => parseActionPlanStep(command, policy.version)),
      next: 0,
      status: 'active',
    };
    return {
      data: {
        plan,
        replaced: resident.plan?.status === 'active' ? resident.plan.id : null,
        runs: 'Steps start after this opportunity, once you are not busy, and continue without waking you. You are woken when it completes, a step is refused, or a paced message arrives.',
      },
      effects: { residents: [{ ...resident, plan }] },
    };
  }
  if (name === 'schedule.plan-cancel') {
    if (resident.plan?.status !== 'active') throw new ToolRefusal('no-active-plan');
    const plan: ResidentActionPlan = { ...resident.plan, status: 'cancelled' };
    return { data: { plan }, effects: { residents: [{ ...resident, plan }] } };
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
  const suppliedId = stringArg(args, 'id');
  // Receipts and lists expose the durable owner-qualified ID. Accept it only for
  // that owner's cancellation, while preserving the existing local-ID interface.
  const prefix = `${actorId}:`;
  const id =
    name === 'schedule.cancel' && suppliedId.startsWith(prefix)
      ? suppliedId.slice(prefix.length)
      : suppliedId;
  if (!validInformationId(id)) throw new ToolRefusal('invalid-reminder-id');
  const key = `${actorId}:${id}`;
  const existing = state.reminders[key];
  if (name === 'schedule.cancel') {
    if (existing === undefined || existing.ownerId !== actorId) throw new ToolRefusal('not-found');
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

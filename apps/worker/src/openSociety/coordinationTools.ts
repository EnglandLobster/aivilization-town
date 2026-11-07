import { checkResidentProgramConditions } from './programConditions';
import {
  canReadProgram,
  prepareProgramRun,
  decideCoordination,
  type CoordinationCommand,
} from '@aivilization/collaboration';
import type { OpenSocietyManifest, OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { ToolRefusal, stringArg, stringArrayArg, numberArg, pageItems } from './arguments';
import { objectArg } from './sharedRecordTools';
import { executeResidentProgram } from './programExecution';
import { digest } from './journal';

export function executeCoordinationTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution & { readonly error?: string } {
  const s = state.coordination;
  if (!s) throw new ToolRefusal('coordination-not-enabled');
  const id = stringArg(args, 'id'),
    expectedRevision = numberArg(args, 'expectedRevision');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const programs = Object.values(s.programs)
    .filter((p) => canReadProgram(p, actorId))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (name === 'programs.list')
    return result(
      pageItems(
        programs.map(({ steps, purpose, conditions, ...p }) => ({
          ...p,
          stepCount: steps.length,
          ...(conditions ? { conditionCount: conditions.length } : {}),
          purposeLength: purpose.length,
        })),
        args,
      ),
    );
  if (name === 'programs.check') {
    if (!s.conditionsPolicy) throw new ToolRefusal('program-conditions-not-enabled');
    const authority = prepareProgramRun(
      s,
      actorId,
      id,
      expectedRevision,
      state.world.clock.now,
      (id) => Object.hasOwn(state.world.agents, id),
    );
    if (!authority.accepted) throw new ToolRefusal(authority.reason);
    const check = checkResidentProgramConditions(state, authority.program);
    if (!check.accepted) throw new ToolRefusal(check.reason);
    return result({
      programId: id,
      programRevision: expectedRevision,
      authorized: true,
      conditionsMatched: check.matched,
      conditionEvidence: check.evidence,
      work: check.work,
      note: 'Execution rechecks all conditions and actual step availability.',
    });
  }
  if (name === 'programs.read') {
    const p = programs.find((p) => p.id === id);
    if (!p) throw new ToolRefusal('program-not-found');
    return result(p);
  }
  if (name === 'programs.history') {
    const history = (s.history[id] ?? []).filter((p) => canReadProgram(p, actorId));
    if (!history.length) throw new ToolRefusal('program-not-found');
    return result(pageItems(history, args));
  }
  const mandates = Object.values(s.mandates)
    .filter((m) => m.principalId === actorId || m.runnerId === actorId)
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (name === 'mandates.list') return result(pageItems(mandates, args));
  if (name === 'mandates.read') {
    const m = mandates.find((m) => m.id === id);
    if (!m) throw new ToolRefusal('mandate-not-found');
    return result(m);
  }
  if (name === 'programs.schedules')
    return result(
      pageItems(
        Object.values(s.schedules)
          .filter((v) => v.runnerId === actorId)
          .sort((a, b) => a.id.localeCompare(b.id, 'en')),
        args,
      ),
    );
  if (name === 'programs.runs')
    return result(
      pageItems(
        Object.values(s.runs)
          .filter(
            (v) =>
              v.participants.includes(actorId) &&
              (!args.programId || v.programId === args.programId),
          )
          .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id, 'en')),
        args,
      ),
    );
  if (name === 'programs.run')
    return executeResidentProgram({
      state,
      manifest,
      runnerId: actorId,
      programId: id,
      programRevision: expectedRevision,
      runId: `run-${digest([actorId, requestId]).slice(0, 32)}`,
    });
  let command: CoordinationCommand;
  if (name === 'programs.publish' || name === 'programs.revise') {
    const common = {
      id,
      title: stringArg(args, 'title'),
      purpose: stringArg(args, 'purpose'),
      runners: stringArrayArg(args, 'runners'),
      definition: objectArg(args, 'definition'),
    };
    command =
      name === 'programs.publish'
        ? { type: name, ...common }
        : { type: name, ...common, expectedRevision };
  } else if (
    name === 'programs.disable' ||
    name === 'mandates.revoke' ||
    name === 'programs.cancel'
  )
    command = { type: name, id, expectedRevision };
  else if (name === 'mandates.grant')
    command = {
      type: name,
      id,
      programId: stringArg(args, 'programId'),
      programRevision: numberArg(args, 'programRevision'),
      runnerId: stringArg(args, 'runnerId'),
      maxRuns: numberArg(args, 'maxRuns'),
      expiresAt: numberArg(args, 'expiresAt'),
    };
  else if (name === 'programs.schedule')
    command = {
      type: name,
      id,
      programId: stringArg(args, 'programId'),
      programRevision: numberArg(args, 'programRevision'),
      startAt: numberArg(args, 'startAt'),
      intervalMs: numberArg(args, 'intervalMs'),
      runs: numberArg(args, 'runs'),
    };
  else throw new ToolRefusal('unknown-coordination-command');
  const d = decideCoordination({
    state: s,
    actorId,
    at: state.world.clock.now,
    command,
    exists: (id) => Object.hasOwn(state.world.agents, id),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: d.events.map((e) =>
      e.type === 'ResidentProgramChanged'
        ? e.program
        : e.type === 'ResidentMandateChanged'
          ? e.mandate
          : e.type === 'ProgramScheduleChanged'
            ? e.schedule
            : null,
    ),
    effects: { coordinationEvents: d.events },
  };
}

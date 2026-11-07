import { checkResidentProgramConditions } from './programConditions';
import type { ConditionEvidence } from '@aivilization/collaboration';
import {
  prepareProgramRun,
  recordProgramRun,
  programPrincipals,
  prepareProgramStepAuthority,
  PROGRAM_ACTIONS_POLICY,
  type ProgramExecutionRecord,
  type CoordinationEvent,
  type ProgramRun,
} from '@aivilization/collaboration';
import type {
  OpenSocietyEffects,
  OpenSocietyManifest,
  OpenSocietyState,
  ResidentExperience,
} from './types';
import type { ToolExecution } from './informationTools';
import { executeInformationTool } from './informationTools';
import { executeCommerceTool } from './commerceTools';
import { executeSharedRecordTool } from './sharedRecordTools';
import { applyOpenSocietyEffects } from './state';
import { ToolRefusal } from './arguments';
import { digest } from './jsonCommitments';
import { assertCapabilityEffects } from './capabilityBoundaries';
import { OPEN_SOCIETY_TOOLS } from './catalog';
import { concatenateEffectOrder, legacyEffectOrder, ORDERED_EFFECT_FAMILIES } from './effectOrder';
import { executeProgramResourceControl } from './programResourceExecution';
import { programEffectCommitments } from './programEffectCommitments';
import { assertProgramStepEffects } from './programStepProof';

/** Concatenate already validated batches, preserving every domain family and explicit cross-family order. */
export function mergeProgramEffects(
  a: OpenSocietyEffects,
  b: OpenSocietyEffects,
): OpenSocietyEffects {
  if (a.cityApps || b.cityApps) throw Error('cannot-merge-domain-enablement');
  const families: OpenSocietyEffects = {};
  for (const family of ORDERED_EFFECT_FAMILIES)
    if (a[family] !== undefined || b[family] !== undefined)
      Object.assign(families, { [family]: [...(a[family] ?? []), ...(b[family] ?? [])] });
  return {
    ...families,
    ...(a.effectOrder || b.effectOrder ? { effectOrder: concatenateEffectOrder(a, b) } : {}),
    experiences: [...(a.experiences ?? []), ...(b.experiences ?? [])],
    residents: [...(a.residents ?? []), ...(b.residents ?? [])],
    ...(a.reminders || b.reminders
      ? { reminders: [...(a.reminders ?? []), ...(b.reminders ?? [])] }
      : {}),
    ...(a.turns || b.turns ? { turns: [...(a.turns ?? []), ...(b.turns ?? [])] } : {}),
  };
}
export function executeResidentProgram(input: {
  state: OpenSocietyState;
  manifest: OpenSocietyManifest;
  runnerId: string;
  programId: string;
  programRevision: number;
  runId: string;
  scheduleId?: string;
}): ToolExecution & { readonly error?: string } {
  const { state, manifest, runnerId, programId, programRevision, runId } = input;
  const s = state.coordination;
  if (!s) throw new ToolRefusal('coordination-not-enabled');
  const prior = s.runs[runId];
  if (prior) {
    if (
      prior.runnerId !== runnerId ||
      prior.programId !== programId ||
      prior.programRevision !== programRevision
    )
      throw new ToolRefusal('program-run-id-conflict');
    return { data: prior, effects: {}, ...(prior.reason ? { error: prior.reason } : {}) };
  }
  const at = state.world.clock.now;
  const check = prepareProgramRun(s, runnerId, programId, programRevision, at, (id) =>
    Object.hasOwn(state.world.agents, id),
  );
  // A caller without access cannot create evidence about another resident's private program.
  if (!check.accepted && check.reason === 'program-not-found' && !input.scheduleId)
    throw new ToolRefusal(check.reason);
  let error = check.accepted ? undefined : check.reason;
  let effects: OpenSocietyEffects = {};
  let conditionEvidence: readonly ConditionEvidence[] | undefined;
  let stepReceipts: ProgramExecutionRecord['steps'][number][] = [];
  const mandates = check.accepted ? check.mandates : [];
  if (check.accepted) {
    let working = state;
    try {
      const conditions = checkResidentProgramConditions(state, check.program);
      if (!conditions.accepted) throw new ToolRefusal(conditions.reason);
      if (check.program.conditions !== undefined) conditionEvidence = conditions.evidence;
      if (!conditions.matched) throw new ToolRefusal('program-conditions-not-met');
      for (const [index, step] of check.program.steps.entries()) {
        const requestId = `program-${digest([runId, index]).slice(0, 32)}`;
        const mandateId = mandates.find((m) => m.principalId === step.principalId)!.id;
        let execution: ToolExecution;
        const authority = check.program.actionPolicyVersion
          ? prepareProgramStepAuthority({
              state: working.coordination!,
              executorId: runnerId,
              programId,
              programRevision,
              runId,
              stepIndex: index,
              at,
              exists: (id) => !!working.world.agents[id],
            })
          : undefined;
        if (authority && !authority.accepted) throw new ToolRefusal(authority.reason);
        if (step.capability === 'resource.control') {
          if (!authority?.accepted) throw new ToolRefusal('program-actions-version-required');
          execution = executeProgramResourceControl({
            state: working,
            manifest,
            authority: authority.authority,
            requestId,
          });
        } else if (step.capability === 'payments.transfer')
          execution = executeCommerceTool(
            working,
            manifest,
            step.principalId,
            step.capability,
            step.arguments,
            requestId,
          );
        else if (step.capability === 'messages.send') {
          execution = executeInformationTool({
            state: working,
            manifest,
            actorId: step.principalId,
            requestId,
            name: step.capability,
            args: step.arguments,
          });
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              informationEvents:
                execution.effects.informationEvents?.map((e) =>
                  e.type === 'MessageSent'
                    ? {
                        ...e,
                        message: {
                          ...e.message,
                          executedBy: runnerId,
                          mandateId,
                          programRunId: runId,
                        },
                      }
                    : e,
                ) ?? [],
              experiences:
                execution.effects.experiences?.map((e) => ({
                  ...e,
                  summary: `[delegated by ${step.principalId}, executed by ${runnerId}, mandate ${mandateId}, run ${runId}] ${e.summary}`,
                  sourceIds: [...e.sourceIds, runId, mandateId],
                })) ?? [],
            },
          };
        } else
          execution = executeSharedRecordTool(
            working,
            runnerId,
            step.capability,
            step.arguments,
            requestId,
            step.principalId,
          );
        if (step.capability !== 'resource.control') {
          const definition = OPEN_SOCIETY_TOOLS.find((t) => t.name === step.capability);
          if (!definition) throw new Error(`unregistered-program-capability:${step.capability}`);
          assertCapabilityEffects(definition, execution.effects);
        }
        if (authority?.accepted) {
          assertProgramStepEffects(working, step, authority.authority, execution.effects);
          stepReceipts.push({
            authority: authority.authority,
            effectIds: programEffectCommitments(execution.effects).map((r) => r.id),
          });
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              effectOrder: execution.effects.effectOrder ?? legacyEffectOrder(execution.effects),
            },
          };
        }
        // No durable mutation occurs until every domain decision has succeeded.
        effects = mergeProgramEffects(effects, execution.effects);
        working = applyOpenSocietyEffects(working, execution.effects);
      }
    } catch (caught) {
      if (!(caught instanceof ToolRefusal)) throw caught;
      error = caught.reason;
      effects = {};
      stepReceipts = [];
    }
  }
  const historical = s.history[programId]?.find((p) => p.revision === programRevision);
  const participants = [
    ...new Set([
      runnerId,
      ...(historical ? [historical.ownerId, ...programPrincipals(historical)] : []),
    ]),
  ].sort();
  const run: ProgramRun = {
    id: runId,
    programId,
    programRevision,
    runnerId,
    participants,
    mandateIds: error ? [] : mandates.map((m) => m.id),
    ...(conditionEvidence === undefined ? {} : { conditionEvidence }),
    status: error ? 'failed' : 'succeeded',
    at,
    ...(error ? { reason: error } : {}),
    ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
    ...(stepReceipts.length && !error
      ? { execution: { version: PROGRAM_ACTIONS_POLICY.execution, steps: stepReceipts } }
      : {}),
  };
  const coordinationEvents: readonly CoordinationEvent[] = recordProgramRun(s, run);
  const experiences: ResidentExperience[] = participants
    .filter((id) => Object.hasOwn(state.residents, id))
    .map((ownerId) => ({
      id: `experience-${runId}-${ownerId}`,
      ownerId,
      at,
      kind: 'action',
      // Deliberately omit other principals' values, balances and step results.
      summary: JSON.stringify({
        kind: 'authorized-program-execution',
        runId,
        programId,
        programRevision,
        runnerId,
        status: run.status,
        ...(error ? { reason: error } : {}),
        ownMandateIds: mandates.filter((m) => m.principalId === ownerId).map((m) => m.id),
      }),
      sourceIds: [runId, programId],
      people: [runnerId],
      provenance: 'firsthand',
    }));
  return {
    data: run,
    effects: mergeProgramEffects(effects, { coordinationEvents, experiences }),
    ...(error ? { error } : {}),
  };
}
export function executeDuePrograms(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
): OpenSocietyEffects {
  let working = state,
    effects: OpenSocietyEffects = {};
  const due = Object.values(state.coordination?.schedules ?? {})
    .filter((s) => s.status === 'active' && s.nextAt === state.world.clock.now)
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  for (const schedule of due) {
    const execution = executeResidentProgram({
      state: working,
      manifest,
      runnerId: schedule.runnerId,
      programId: schedule.programId,
      programRevision: schedule.programRevision,
      scheduleId: schedule.id,
      runId: `run-${digest([schedule.id, schedule.completedRuns]).slice(0, 32)}`,
    });
    effects = mergeProgramEffects(effects, execution.effects);
    working = applyOpenSocietyEffects(working, execution.effects);
  }
  return effects;
}

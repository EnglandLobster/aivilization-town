import {
  coordinationId,
  canReadProgram,
  programPrincipals,
  type CoordinationState,
  type ResidentMandate,
  type ResidentProgram,
  type ProgramRun,
} from './programModel';
import {
  PROGRAM_ACTIONS_POLICY,
  resolveProgramActionsPolicy,
  type ProgramStepAuthority,
} from './programActions';
const no = (reason: string) => ({ accepted: false as const, reason });
export function prepareProgramRun(
  s: CoordinationState,
  actor: string,
  programId: string,
  revision: number,
  at: number,
  exists: (id: string) => boolean,
):
  | { accepted: true; program: ResidentProgram; mandates: readonly ResidentMandate[] }
  | { accepted: false; reason: string } {
  if (!coordinationId(programId) || !Number.isSafeInteger(at) || at < 0)
    return no('program-not-found');
  const p = Object.hasOwn(s.programs, programId) ? s.programs[programId] : undefined;
  if (!p || !canReadProgram(p, actor)) return no('program-not-found');
  if (!p.active || p.revision !== revision) return no('program-version-inactive');
  if (!p.runners.includes(actor) || !exists(actor)) return no('program-runner-required');
  const mandates: ResidentMandate[] = [];
  for (const principal of programPrincipals(p)) {
    if (!exists(principal)) return no('principal-unavailable');
    const mandate = Object.values(s.mandates)
      .filter(
        (m) =>
          m.principalId === principal &&
          m.runnerId === actor &&
          m.programId === p.id &&
          m.programRevision === p.revision &&
          !m.revoked &&
          m.expiresAt > at &&
          m.usedRuns < m.maxRuns,
      )
      .sort((a, b) => a.id.localeCompare(b.id, 'en'))[0];
    if (!mandate) return no('program-mandate-required');
    mandates.push(mandate);
  }
  return { accepted: true, program: p, mandates };
}
/** Resolves current independent mandates for one exact signed step; does not execute or consume authority. */
export function prepareProgramStepAuthority(input: {
  state: CoordinationState;
  executorId: string;
  programId: string;
  programRevision: number;
  runId: string;
  stepIndex: number;
  at: number;
  exists: (id: string) => boolean;
}): { accepted: true; authority: ProgramStepAuthority } | { accepted: false; reason: string } {
  const { state: s, executorId, programId, programRevision, runId, stepIndex, at, exists } = input;
  if (!coordinationId(runId) || !Number.isSafeInteger(stepIndex) || stepIndex < 0)
    return no('invalid-program-step-reference');
  const run = prepareProgramRun(s, executorId, programId, programRevision, at, exists);
  if (!run.accepted) return run;
  const policy = resolveProgramActionsPolicy(s.actionsPolicy, run.program.actionPolicyVersion);
  if (!policy) return no('program-actions-version-required');
  const step = run.program.steps[stepIndex];
  if (!step) return no('invalid-program-step-reference');
  const mandate = run.mandates.find((m) => m.principalId === step.principalId);
  if (!mandate) return no('program-mandate-required');
  return {
    accepted: true,
    authority: {
      policyVersion: policy.version,
      programId,
      programRevision,
      runId,
      stepIndex,
      principalId: step.principalId,
      executedBy: executorId,
      mandateId: mandate.id,
      mandateRevision: mandate.revision,
      at,
    },
  };
}
/** Does not decide effects. It binds the successful receipt to every independent original mandate and exact step. */
export function assertProgramExecutionAuthority(s: CoordinationState, run: ProgramRun) {
  const p = s.programs[run.programId],
    execution = run.execution;
  if (run.status !== 'succeeded' || !p?.actionPolicyVersion) {
    if (execution) throw Error('unexpected-program-execution-record');
    return;
  }
  if (
    !execution ||
    execution.version !== PROGRAM_ACTIONS_POLICY.execution ||
    execution.steps.length !== p.steps.length
  )
    throw Error('program-step-execution-record-required');
  const ids = new Set<string>();
  for (const [stepIndex, receipt] of execution.steps.entries()) {
    const expected = prepareProgramStepAuthority({
      state: s,
      executorId: run.runnerId,
      programId: run.programId,
      programRevision: run.programRevision,
      runId: run.id,
      stepIndex,
      at: run.at,
      exists: () => true,
    });
    if (
      !expected.accepted ||
      Object.keys(receipt.authority).length !== Object.keys(expected.authority).length ||
      Object.entries(expected.authority).some(
        ([k, v]) => receipt.authority[k as keyof ProgramStepAuthority] !== v,
      ) ||
      !run.mandateIds.includes(receipt.authority.mandateId)
    )
      throw Error('program-step-execution-authority-mismatch');
    if (
      !receipt.effectIds.length ||
      receipt.effectIds.length > PROGRAM_ACTIONS_POLICY.maxStepEffects
    )
      throw Error('invalid-program-step-effect-count');
    for (const id of receipt.effectIds) {
      if (!/^[0-9a-f]{64}$/.test(id) || ids.has(id))
        throw Error('invalid-or-duplicate-program-effect-commitment');
      ids.add(id);
    }
  }
}

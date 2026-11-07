import {
  prepareProgramStepAuthority,
  parseProgramResourceControl,
  resolveProgramActionsPolicy,
  type ProgramStepAuthority,
} from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { executePremisesTool } from './premisesTools';
import { executeMaterialTool } from './materialTools';
import { executeResourceControlTool } from './resourceControlTools';
import { ToolRefusal } from './arguments';
import { assertProgramResourceEffects } from './programResourceProof';

/** Internal admission port. The caller must persist the returned step authority in the atomic program receipt. */
export function executeProgramResourceControl(input: {
  state: OpenSocietyState;
  manifest: OpenSocietyManifest;
  authority: ProgramStepAuthority;
  requestId: string;
}): ToolExecution & { readonly authority: ProgramStepAuthority } {
  const { state, manifest, authority, requestId } = input;
  if (!state.coordination) throw new ToolRefusal('coordination-not-enabled');
  const current = prepareProgramStepAuthority({
    state: state.coordination,
    executorId: authority.executedBy,
    programId: authority.programId,
    programRevision: authority.programRevision,
    runId: authority.runId,
    stepIndex: authority.stepIndex,
    at: state.world.clock.now,
    exists: (id) => !!state.world.agents[id],
  });
  if (!current.accepted) throw new ToolRefusal(current.reason);
  if (
    Object.keys(authority).length !== Object.keys(current.authority).length ||
    Object.entries(current.authority).some(
      ([k, v]) => authority[k as keyof ProgramStepAuthority] !== v,
    )
  )
    throw new ToolRefusal('program-step-authority-changed');
  const step = state.coordination.programs[authority.programId]!.steps[authority.stepIndex]!;
  if (step.capability !== 'resource.control')
    throw new ToolRefusal('program-resource-step-required');
  const policy = resolveProgramActionsPolicy(
    state.coordination.actionsPolicy,
    authority.policyVersion,
  );
  const action = policy && parseProgramResourceControl(step.arguments, policy);
  if (!action) throw new ToolRefusal('invalid-program-resource-action');
  const c = action.control,
    base = {
      id: action.resourceId,
      expectedRevision: action.expectedRevision,
      expectedControlVersion: c.expectedVersion,
    };
  let execution: ToolExecution;
  // The domain's actor is the represented authority principal; the actual executor remains explicit in this required receipt.
  // No caller-supplied actor or arbitrary capability is forwarded; all input comes from the independently mandated original step.
  if (action.resourceKind === 'premises' || action.resourceKind === 'stock') {
    const prefix = action.resourceKind === 'premises' ? 'premises' : 'stocks';
    const name = `${prefix}.${c.type === 'cancel' ? 'cancel-offer' : c.type}`;
    const args = {
      ...base,
      ...(c.type === 'offer'
        ? {
            targetKind: c.target.kind,
            targetId: c.target.id,
            expiresAt: c.expiresAt,
            terms: c.terms,
          }
        : {}),
    };
    execution =
      action.resourceKind === 'premises'
        ? executePremisesTool(state, manifest, authority.principalId, name, args, requestId)
        : executeMaterialTool(state, manifest, authority.principalId, name, args, requestId);
  } else {
    const args = {
      ...base,
      kind: action.resourceKind,
      ...(c.type === 'offer' ? { target: c.target, expiresAt: c.expiresAt, terms: c.terms } : {}),
    };
    execution = executeResourceControlTool(
      state,
      manifest,
      authority.principalId,
      `resources.${c.type}`,
      args,
      requestId,
    );
  }
  assertProgramResourceEffects(state, action, current.authority, execution.effects);
  return {
    ...execution,
    authority: current.authority,
    effects: {
      ...execution.effects,
      ...(execution.effects.experiences
        ? {
            experiences: execution.effects.experiences.map((e) => ({
              ...e,
              summary: `[authorized by ${authority.principalId}, executed by ${authority.executedBy}, mandate ${authority.mandateId}, run ${authority.runId}, step ${authority.stepIndex}] ${e.summary}`,
              sourceIds: [...e.sourceIds, authority.runId, authority.mandateId],
            })),
          }
        : {}),
    },
  };
}

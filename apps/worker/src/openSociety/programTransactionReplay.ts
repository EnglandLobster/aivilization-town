import { recordProgramRun, type ProgramRun } from '@aivilization/collaboration';
import { tradeFactsEqual } from '@aivilization/commerce';
import { validatedEffectOrder, type OrderableEffects } from './effectOrder';
import { digest } from './jsonCommitments';
import { assertProgramStepEffects } from './programStepProof';
import type { OpenSocietyEffects, OpenSocietyState } from './types';

/** Checks the stored execution against signed steps, in original order, before consuming any mandate.
 * Resource/account/record reducers apply final facts; no live tool, model, clock or decision adapter is called.
 */
export function applyOrderedProgramEffects(
  before: OpenSocietyState,
  effects: OpenSocietyEffects,
  apply: (s: OpenSocietyState, effects: OpenSocietyEffects) => OpenSocietyState,
): OpenSocietyState {
  const refs = validatedEffectOrder(effects).entries;
  const packet = (index: number): OrderableEffects => {
    const ref = refs[index];
    if (!ref) throw Error('incomplete-program-transaction');
    return { [ref.family]: [effects[ref.family]![ref.index]!] };
  };
  const commitments = refs.map((ref) =>
    digest({
      schema: 'program-effect-commitment-v1',
      family: ref.family,
      event: effects[ref.family]![ref.index]!,
    }),
  );
  const starts = new Map<number, ProgramRun>(),
    receiptIndexes = new Set<number>();
  for (const [index, ref] of refs.entries()) {
    if (ref.family !== 'coordinationEvents') continue;
    const event = effects.coordinationEvents![ref.index]!;
    if (event.type !== 'ProgramRunRecorded' || !event.run.execution) continue;
    const run = event.run,
      first = run.execution!.steps[0]?.effectIds[0];
    const start = first ? commitments.indexOf(first) : -1;
    if (start < 0 || start >= index || starts.has(start))
      throw Error('program-transaction-effects-required');
    starts.set(start, run);
    receiptIndexes.add(index);
  }
  let state = before;
  for (let index = 0; index < refs.length; ) {
    const run = starts.get(index);
    if (!run) {
      if (receiptIndexes.has(index)) throw Error('program-transaction-receipt-out-of-order');
      const p = packet(index),
        event = p.coordinationEvents?.[0];
      if (
        event?.type === 'ProgramRunRecorded' &&
        event.run.status === 'succeeded' &&
        state.coordination?.programs[event.run.programId]?.actionPolicyVersion
      )
        throw Error('program-step-execution-record-required');
      state = apply(state, p);
      index++;
      continue;
    }
    if (!state.coordination || state.world.clock.now !== run.at)
      throw Error('program-transaction-clock-or-authority-mismatch');
    // The owning coordination domain validates the original mandates and their exact consumption receipts.
    const lifecycle = recordProgramRun(state.coordination, run);
    const program = state.coordination.programs[run.programId]!;
    for (const [stepIndex, receipt] of run.execution!.steps.entries()) {
      const stepRefs = refs.slice(index, index + receipt.effectIds.length);
      if (
        !tradeFactsEqual(
          commitments.slice(index, index + receipt.effectIds.length),
          receipt.effectIds,
        )
      )
        throw Error('program-step-effects-missing-or-reordered');
      // A receipt cannot wrap, overlap or smuggle another program's effects.
      if (stepRefs.some((_, n) => n > 0 && starts.has(index + n)))
        throw Error('overlapping-program-transactions');
      const stepEffects: OpenSocietyEffects = {
        effectOrder: { version: 'ordered-society-effects-v1', entries: [] },
      };
      const groups = new Map<string, number>();
      const entries = stepRefs.map((ref) => {
        const localIndex = groups.get(ref.family) ?? 0;
        groups.set(ref.family, localIndex + 1);
        // Typed packets avoid combining incompatible domain event unions through an indexed assignment.
        Object.assign(stepEffects, {
          [ref.family]: [...(stepEffects[ref.family] ?? []), effects[ref.family]![ref.index]!],
        });
        return { family: ref.family, index: localIndex };
      });
      const orderedStep = {
        ...stepEffects,
        effectOrder: { version: 'ordered-society-effects-v1' as const, entries },
      };
      assertProgramStepEffects(state, program.steps[stepIndex]!, receipt.authority, orderedStep);
      for (let n = 0; n < receipt.effectIds.length; n++) state = apply(state, packet(index++));
    }
    for (const expected of lifecycle) {
      const ref = refs[index],
        actual =
          ref?.family === 'coordinationEvents'
            ? effects.coordinationEvents?.[ref.index]
            : undefined;
      if (!tradeFactsEqual(actual, expected)) throw Error('program-lifecycle-receipt-mismatch');
      state = apply(state, packet(index++));
    }
  }
  return state;
}

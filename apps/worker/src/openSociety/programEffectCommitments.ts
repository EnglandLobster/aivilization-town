import type { OpenSocietyEffects } from './types';
import { validatedEffectOrder, type OrderedEffectFamily } from './effectOrder';
import { digest } from './jsonCommitments';
import { PROGRAM_ACTIONS_POLICY } from '@aivilization/collaboration';
const allowed = new Set<OrderedEffectFamily>([
  'worldEvents',
  'informationEvents',
  'sharedRecordsEvents',
  'communicationEvents',
  'collectiveEvents',
]);
/** Stable references bind a run receipt to original owning-domain event bytes without copying private originals into another ledger. */
export function programEffectCommitments(effects: OpenSocietyEffects) {
  if (effects.cityApps || effects.reminders?.length || effects.turns?.length)
    throw Error('unsupported-program-step-metadata');
  const entries = validatedEffectOrder(effects).entries;
  if (!entries.length || entries.length > PROGRAM_ACTIONS_POLICY.maxStepEffects)
    throw Error('invalid-program-step-effect-count');
  const result = entries.map((ref) => {
    if (!allowed.has(ref.family)) throw Error('unsupported-program-step-effect-family');
    const event = effects[ref.family]![ref.index]!;
    return {
      family: ref.family,
      index: ref.index,
      id: digest({ schema: 'program-effect-commitment-v1', family: ref.family, event }),
    };
  });
  if (new Set(result.map((e) => e.id)).size !== result.length)
    throw Error('duplicate-program-step-effect');
  return result;
}

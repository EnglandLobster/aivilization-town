import type { OpenSocietyEffects } from './types';

/** Same family order as legacy applyOpenSocietyEffects. Old commits carry no order declaration. */
export const ORDERED_EFFECT_FAMILIES = [
  'worldEvents',
  'informationEvents',
  'collectiveEvents',
  'recordViewEvents',
  'sharedRecordsEvents',
  'coordinationEvents',
  'collaborationEvents',
  'householdEvents',
  'careEvents',
  'healthRecordEvents',
  'learningEvents',
  'servicesEvents',
  'communicationEvents',
  'distributionEvents',
  'cognitiveEvents',
] as const satisfies readonly (keyof OpenSocietyEffects)[];
export type OrderedEffectFamily = (typeof ORDERED_EFFECT_FAMILIES)[number];
export type SocietyEffectOrder = {
  readonly version: 'ordered-society-effects-v1';
  readonly entries: readonly { readonly family: OrderedEffectFamily; readonly index: number }[];
};
export type OrderableEffects = Pick<OpenSocietyEffects, OrderedEffectFamily> & {
  readonly effectOrder?: SocietyEffectOrder;
};
const family = (v: unknown): v is OrderedEffectFamily =>
  typeof v === 'string' && ORDERED_EFFECT_FAMILIES.some((f) => f === v);
export function legacyEffectOrder(effects: OrderableEffects): SocietyEffectOrder {
  return {
    version: 'ordered-society-effects-v1',
    entries: ORDERED_EFFECT_FAMILIES.flatMap((f) =>
      (effects[f] ?? []).map((_, index) => ({ family: f, index })),
    ),
  };
}
/** Every event appears once; every owning aggregate's event order remains monotone. */
export function validatedEffectOrder(effects: OrderableEffects): SocietyEffectOrder {
  const order =
    effects.effectOrder === undefined ? legacyEffectOrder(effects) : effects.effectOrder;
  if (!order || order.version !== 'ordered-society-effects-v1' || !Array.isArray(order.entries))
    throw Error('unsupported-effect-order');
  const next: Partial<Record<OrderedEffectFamily, number>> = {};
  const entries: SocietyEffectOrder['entries'] = order.entries;
  for (const entry of entries) {
    if (
      !entry ||
      !family(entry.family) ||
      Object.keys(entry).length !== 2 ||
      !Number.isSafeInteger(entry.index) ||
      entry.index !== (next[entry.family] ?? 0) ||
      entry.index >= (effects[entry.family]?.length ?? 0)
    )
      throw Error('invalid-effect-order-reference');
    next[entry.family] = entry.index + 1;
  }
  if (ORDERED_EFFECT_FAMILIES.some((f) => (next[f] ?? 0) !== (effects[f]?.length ?? 0)))
    throw Error('incomplete-effect-order');
  return order;
}
/** Used when an already ordered transaction gains another step or reaction; references are rebased, not flattened by family. */
export function concatenateEffectOrder(
  a: OrderableEffects,
  b: OrderableEffects,
): SocietyEffectOrder {
  const left = validatedEffectOrder(a),
    right = validatedEffectOrder(b);
  return {
    version: 'ordered-society-effects-v1',
    entries: [
      ...left.entries,
      ...right.entries.map((e) => ({
        family: e.family,
        index: e.index + (a[e.family]?.length ?? 0),
      })),
    ],
  };
}
/** These packets preserve the original events. Domain reducers keep exclusive ownership of their contents. */
export function orderedDomainPackets(effects: OrderableEffects): readonly OrderableEffects[] {
  return validatedEffectOrder(effects).entries.map((e) => ({
    [e.family]: [effects[e.family]![e.index]!],
  }));
}

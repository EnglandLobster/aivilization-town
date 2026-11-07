import { expect, test } from 'vitest';
import {
  observeConstructionTradeFacts,
  type ConstructionTradeBasis,
  type ConstructionTradeEvidence,
} from './constructionTradeFacts';
const basis: ConstructionTradeBasis = {
  projectId: 'p',
  kind: 'build',
  siteId: 's',
  buildingId: 'b',
  beneficiary: { kind: 'resident', id: 'buyer' },
  specificationHash: 'a'.repeat(64),
  requiredWorkMs: 1000,
};
const facts = (overrides: Partial<ConstructionTradeEvidence> = {}): ConstructionTradeEvidence => ({
  sourceVersion: 'resident-premises-v1',
  basis,
  revision: 1,
  at: 0,
  progressMs: 0,
  status: 'open',
  ...overrides,
});
test('real progress is pending, exact completion delivers, and observation is detached and replay stable', () => {
  const start = facts(),
    partial = facts({ revision: 2, at: 500, progressMs: 500 });
  expect(observeConstructionTradeFacts(basis, start, partial, 500)).toMatchObject({
    accepted: true,
    observation: { objectiveDelivery: 'pending' },
  });
  const final = facts({ revision: 3, at: 1000, progressMs: 1000, status: 'completed' });
  const result = observeConstructionTradeFacts(basis, partial, final, 1000);
  expect(result).toMatchObject({ accepted: true, observation: { objectiveDelivery: 'completed' } });
  expect(
    observeConstructionTradeFacts(
      JSON.parse(JSON.stringify(basis)) as ConstructionTradeBasis,
      JSON.parse(JSON.stringify(partial)) as ConstructionTradeEvidence,
      JSON.parse(JSON.stringify(final)) as ConstructionTradeEvidence,
      1000,
    ),
  ).toEqual(result);
  if (result.accepted) {
    expect(result.observation.evidence).not.toBe(final);
    expect(result.observation.evidence.basis).not.toBe(basis);
  }
  expect(observeConstructionTradeFacts(basis, final, final, 2000).accepted).toBe(true);
});
test('missing and cancelled facts never invent completion, refund, or satisfaction', () => {
  expect(observeConstructionTradeFacts(basis, undefined, undefined, 0)).toEqual({
    accepted: false,
    reason: 'construction-trade-source-unavailable',
  });
  const cancelled = facts({ revision: 2, at: 500, progressMs: 500, status: 'cancelled' });
  expect(observeConstructionTradeFacts(basis, facts(), cancelled, 500)).toMatchObject({
    accepted: true,
    observation: { objectiveDelivery: 'cancelled-without-delivery', evidence: { progressMs: 500 } },
  });
  expect(
    observeConstructionTradeFacts(
      basis,
      cancelled,
      facts({ revision: 3, at: 600, progressMs: 600 }),
      600,
    ),
  ).toMatchObject({ accepted: false, reason: 'construction-trade-terminal-evidence-changed' });
});
test('frozen subject, plan and authority cannot be substituted under an old order', () => {
  for (const change of [
    { projectId: 'other' },
    { siteId: 'other' },
    { buildingId: 'other' },
    { kind: 'modify' as const },
    { beneficiary: { kind: 'resident' as const, id: 'other' } },
    { specificationHash: 'b'.repeat(64) },
    { requiredWorkMs: 2000 },
  ])
    expect(
      observeConstructionTradeFacts(basis, undefined, facts({ basis: { ...basis, ...change } }), 0),
    ).toMatchObject({ accepted: false, reason: 'construction-trade-basis-changed' });
});
test('rejects invalid numbers, unearned completion, revision reuse and backward evidence', () => {
  for (const change of [
    { progressMs: -1 },
    { progressMs: Infinity },
    { progressMs: 1001 },
    { status: 'completed' as const },
    { revision: 0 },
    { revision: 1.5 },
    { at: 1 },
  ])
    expect(observeConstructionTradeFacts(basis, undefined, facts(change), 0).accepted).toBe(false);
  expect(observeConstructionTradeFacts(basis, facts(), facts({ progressMs: 1 }), 0)).toMatchObject({
    accepted: false,
    reason: 'construction-trade-revision-reused',
  });
  const previous = facts({ revision: 3, at: 500, progressMs: 500 });
  for (const change of [{ revision: 2 }, { at: 499 }, { progressMs: 499 }])
    expect(
      observeConstructionTradeFacts(basis, previous, { ...previous, ...change }, 500),
    ).toMatchObject({ accepted: false, reason: 'construction-trade-evidence-regressed' });
  expect(
    observeConstructionTradeFacts({ ...basis, requiredWorkMs: 0 }, undefined, facts(), 0).accepted,
  ).toBe(false);
  expect(observeConstructionTradeFacts(basis, undefined, facts(), NaN).accepted).toBe(false);
});

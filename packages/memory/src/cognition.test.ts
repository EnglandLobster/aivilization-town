import { describe, expect, test } from 'vitest';
import { applyCognitiveEvent, decideCognitiveUpdate, type CognitiveUpdate } from './cognition';
const update: CognitiveUpdate = {
  key: 'trust-bob',
  kind: 'belief',
  statement: 'Bob may be reliable',
  confidence: 0.6,
  evidenceIds: ['m1'],
  expectedRevision: 0,
  active: true,
};
const decide = (change: CognitiveUpdate) =>
  decideCognitiveUpdate({
    state: {},
    ownerId: 'alice',
    at: 100,
    update: change,
    visibleEvidenceIds: new Set(['m1']),
  });
describe('personal cognition', () => {
  test('records subjective interpretation, owner, evidence and revision; replay is pure', () => {
    const result = decide(update);
    if (!result.accepted) throw new Error(result.reason);
    const state = applyCognitiveEvent({}, result.event);
    expect(state['trust-bob']).toMatchObject({
      ownerId: 'alice',
      confidence: 0.6,
      revision: 1,
      updatedAt: 100,
    });
    expect(applyCognitiveEvent(state, result.event)).toEqual(state);
    expect(
      decideCognitiveUpdate({
        state,
        ownerId: 'alice',
        at: 110,
        update,
        visibleEvidenceIds: new Set(['m1']),
      }),
    ).toMatchObject({ reason: 'revision-conflict' });
  });
  test('permits spontaneous goals without fabricated evidence', () => {
    expect(
      decide({ ...update, kind: 'goal', evidenceIds: [], statement: 'I want to travel' }).accepted,
    ).toBe(true);
  });
  test('rejects private evidence, invalid values, and unsafe keys', () => {
    expect(decide({ ...update, evidenceIds: ['bob-private-memory'] })).toMatchObject({
      reason: 'evidence-not-visible',
    });
    for (const confidence of [-1, 1.01, NaN, Infinity])
      expect(decide({ ...update, confidence })).toMatchObject({ reason: 'invalid-cognition' });
    expect(decide({ ...update, key: '__proto__' })).toMatchObject({ reason: 'invalid-cognition' });
    expect(decide({ ...update, statement: 'x'.repeat(8001) })).toMatchObject({
      reason: 'invalid-cognition',
    });
    expect(decide({ ...update, confidence: 0 }).accepted).toBe(true);
    expect(decide({ ...update, confidence: 1 }).accepted).toBe(true);
  });
});

test('v2 archive frees active capacity, pins are personal, and v1 limits remain replay compatible', () => {
  const entry = { ...update, ownerId: 'alice', revision: 1, updatedAt: 0 };
  const state = Object.fromEntries(
    Array.from({ length: 256 }, (_, i) => [`n${i}`, { ...entry, key: `n${i}`, active: i !== 0 }]),
  );
  const base = {
    state,
    ownerId: 'alice',
    at: 1,
    update: { ...update, key: 'new', pinned: true, people: ['bob'] },
    visibleEvidenceIds: new Set(['m1']),
  };
  expect(decideCognitiveUpdate(base)).toMatchObject({ accepted: false, reason: 'cognition-limit' });
  const d = decideCognitiveUpdate({ ...base, policyVersion: 'resident-cognition-v2' });
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw new Error(d.reason);
  const next = applyCognitiveEvent(state, d.event);
  expect(next.new).toMatchObject({ pinned: true, people: ['bob'] });
  expect(
    decideCognitiveUpdate({
      ...base,
      state: next,
      update: { ...update, key: 'over' },
      policyVersion: 'resident-cognition-v2',
    }),
  ).toMatchObject({ accepted: false, reason: 'active-cognition-limit-archive-an-entry' });
  const revised = decideCognitiveUpdate({
    ...base,
    state: next,
    update: { ...update, key: 'new', expectedRevision: 1 },
    policyVersion: 'resident-cognition-v2',
  });
  expect(revised).toMatchObject({
    accepted: true,
    event: { entry: { pinned: true, people: ['bob'] } },
  });
});

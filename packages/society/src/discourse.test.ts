import { describe, expect, it } from 'vitest';
import {
  assertValidTownDiscoursePolicy,
  evaluateDiscoursePropagation,
  HEARSAY_CHAIN_TAG_PREFIX,
  parseHearsayChainDepth,
  type DiscoursePropagationCandidate,
  type TownDiscoursePolicy,
} from './discourse';

const policy: TownDiscoursePolicy = {
  policyVersion: 'town-discourse-v1',
  propagationProbabilityPercent: 40,
  importanceMultiplierRange: [0.7, 1.3],
  maxChainDepth: 3,
};

function candidate(
  overrides: Partial<DiscoursePropagationCandidate> = {},
): DiscoursePropagationCandidate {
  return {
    recordId: 'record-a',
    importanceScore: 0.6,
    tags: [],
    chainDepth: 0,
    ...overrides,
  };
}

describe('parseHearsayChainDepth', () => {
  it('parses the chain tag and defaults to 0', () => {
    expect(parseHearsayChainDepth([])).toBe(0);
    expect(parseHearsayChainDepth(['hearsay-chain:2'])).toBe(2);
    expect(parseHearsayChainDepth(['conversation', 'hearsay-chain:3', 'x'])).toBe(3);
    expect(parseHearsayChainDepth(['hearsay-chain:not-a-number'])).toBe(0);
    expect(parseHearsayChainDepth(['hearsay-chain:-1'])).toBe(0);
  });

  it('exposes the tag prefix used by the world adapter', () => {
    expect(HEARSAY_CHAIN_TAG_PREFIX).toBe('hearsay-chain:');
  });
});

describe('evaluateDiscoursePropagation', () => {
  it('gates on the probability roll', () => {
    // 40%: roll 0.399 passes, 0.4 misses (probability is exclusive of the roll).
    expect(
      evaluateDiscoursePropagation({
        candidates: [candidate()],
        policy,
        gateRoll: 0.399,
        distortionRoll: 0.5,
      }),
    ).not.toBeNull();
    expect(
      evaluateDiscoursePropagation({
        candidates: [candidate()],
        policy,
        gateRoll: 0.4,
        distortionRoll: 0.5,
      }),
    ).toBeNull();
    expect(
      evaluateDiscoursePropagation({
        candidates: [candidate()],
        policy: { ...policy, propagationProbabilityPercent: 0 },
        gateRoll: 0,
        distortionRoll: 0.5,
      }),
    ).toBeNull();
  });

  it('selects the highest-importance eligible candidate with a stable tiebreak', () => {
    const decision = evaluateDiscoursePropagation({
      candidates: [
        candidate({ recordId: 'record-low', importanceScore: 0.2 }),
        candidate({ recordId: 'record-high', importanceScore: 0.9 }),
        candidate({ recordId: 'record-tie', importanceScore: 0.9 }),
      ],
      policy,
      gateRoll: 0,
      distortionRoll: 0.5,
    });
    expect(decision?.candidate.recordId).toBe('record-high');
  });

  it('never propagates implanted or corrected/doubtful/past memories', () => {
    const ineligible = [
      candidate({ recordId: 'implanted', provenanceKind: 'implanted' }),
      candidate({ recordId: 'corrected', provenanceStatus: 'corrected' }),
      candidate({ recordId: 'doubtful', provenanceStatus: 'doubtful' }),
      candidate({ recordId: 'past', provenanceStatus: 'past' }),
      candidate({ recordId: 'zero', importanceScore: 0 }),
    ];
    expect(
      evaluateDiscoursePropagation({
        candidates: ineligible,
        policy,
        gateRoll: 0,
        distortionRoll: 0.5,
      }),
    ).toBeNull();
  });

  it('stops re-sharing hearsay at the chain-depth cap', () => {
    expect(
      evaluateDiscoursePropagation({
        candidates: [candidate({ chainDepth: 2 })],
        policy,
        gateRoll: 0,
        distortionRoll: 0.5,
      })?.nextChainDepth,
    ).toBe(3);
    expect(
      evaluateDiscoursePropagation({
        candidates: [candidate({ chainDepth: 3 })],
        policy,
        gateRoll: 0,
        distortionRoll: 0.5,
      }),
    ).toBeNull();
  });

  it('distorts importance by lerping the multiplier range and clamps to [0, 1]', () => {
    // Range [0.7, 1.3] on importance 0.5: rolls 0/0.5/1 → 0.35/0.5/0.65.
    const distortedAt = (distortionRoll: number) =>
      evaluateDiscoursePropagation({
        candidates: [candidate({ importanceScore: 0.5 })],
        policy,
        gateRoll: 0,
        distortionRoll,
      })?.distortedImportance;
    expect(distortedAt(0)).toBeCloseTo(0.35, 10);
    expect(distortedAt(0.5)).toBeCloseTo(0.5, 10);
    expect(distortedAt(0.999)).toBeCloseTo(0.6497, 3);
    // Clamp: importance 1 × multiplier 1.3 stays 1.
    expect(
      evaluateDiscoursePropagation({
        candidates: [candidate({ importanceScore: 1 })],
        policy,
        gateRoll: 0,
        distortionRoll: 0.999,
      })?.distortedImportance,
    ).toBe(1);
  });

  it('is deterministic for identical inputs', () => {
    const first = evaluateDiscoursePropagation({
      candidates: [candidate()],
      policy,
      gateRoll: 0.1,
      distortionRoll: 0.7,
    });
    const second = evaluateDiscoursePropagation({
      candidates: [candidate()],
      policy,
      gateRoll: 0.1,
      distortionRoll: 0.7,
    });
    expect(second).toEqual(first);
  });
});

describe('assertValidTownDiscoursePolicy', () => {
  it('accepts the canonical policy and rejects invalid fields', () => {
    expect(() => assertValidTownDiscoursePolicy(policy)).not.toThrow();
    expect(() => assertValidTownDiscoursePolicy({ ...policy, policyVersion: ' ' })).toThrow(
      'policyVersion must not be empty',
    );
    expect(() =>
      assertValidTownDiscoursePolicy({ ...policy, propagationProbabilityPercent: 101 }),
    ).toThrow('[0, 100]');
    expect(() =>
      assertValidTownDiscoursePolicy({ ...policy, importanceMultiplierRange: [1.3, 0.7] }),
    ).toThrow('importanceMultiplierRange');
    expect(() =>
      assertValidTownDiscoursePolicy({ ...policy, importanceMultiplierRange: [0, 1] }),
    ).toThrow('importanceMultiplierRange');
    expect(() => assertValidTownDiscoursePolicy({ ...policy, maxChainDepth: 0 })).toThrow(
      'maxChainDepth',
    );
  });
});

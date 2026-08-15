import { describe, expect, it } from 'vitest';
import type { AgentId } from '@aivilization/sim-core';
import {
  calculateIllnessDeathProbabilityPercent,
  calculatePensionAccrual,
  deriveAgentAgeMs,
  deriveLifecycleStage,
  assertValidLifecyclePolicy,
  evaluateIllnessDeath,
  evaluateOldAgeDeath,
  evaluateRetirement,
  resolveAgentLifespanMs,
  type LifecyclePolicy,
} from './lifecycle';

const DAY_MS = 86_400_000;

const policy: LifecyclePolicy = {
  policyVersion: 'test-lifecycle-v1',
  dayLengthMs: DAY_MS,
  stageThresholdsDays: { teen: 15, adult: 21, elderly: 70 },
  minLifespanDays: 90,
  maxLifespanDays: 130,
  illnessDeathHealthThreshold: 30,
  illnessDeathProbabilityPerSettlementScale: 20,
  pensionPerHour: 1.5,
};

describe('deriveAgentAgeMs', () => {
  it('counts age from the adult threshold at registration', () => {
    const ageMs = deriveAgentAgeMs({
      nowMs: 10 * DAY_MS,
      registeredAtMs: 4 * DAY_MS,
      policy,
    });
    expect(ageMs).toBe((10 - 4 + 21) * DAY_MS);
  });

  it('treats legacy agents as registered at simulation time zero', () => {
    expect(
      deriveAgentAgeMs({ nowMs: 5 * DAY_MS, registeredAtMs: 0, policy }),
    ).toBe((5 + 21) * DAY_MS);
  });

  it('rejects a registration timestamp in the future', () => {
    expect(() =>
      deriveAgentAgeMs({ nowMs: DAY_MS, registeredAtMs: 2 * DAY_MS, policy }),
    ).toThrow('registeredAtMs must not exceed nowMs');
  });
});

describe('calculatePensionAccrual', () => {
  it('accrues linearly with elapsed time', () => {
    expect(
      calculatePensionAccrual({ elapsedMs: 3_600_000, policy }),
    ).toBe(1.5);
    expect(calculatePensionAccrual({ elapsedMs: 7_200_000, policy })).toBe(3);
  });

  it('accrues nothing when no time elapsed', () => {
    expect(calculatePensionAccrual({ elapsedMs: 0, policy })).toBe(0);
  });

  it('is strictly additive across split intervals', () => {
    const merged = calculatePensionAccrual({ elapsedMs: 9_000_000, policy });
    const split =
      calculatePensionAccrual({ elapsedMs: 4_000_000, policy }) +
      calculatePensionAccrual({ elapsedMs: 5_000_000, policy });
    expect(merged).toBe(split);
  });
});

describe('deriveLifecycleStage', () => {
  it('maps ages onto the four stage thresholds', () => {
    const stageAt = (days: number) =>
      deriveLifecycleStage({ ageMs: days * DAY_MS, policy });
    expect(stageAt(14)).toBe('child');
    expect(stageAt(15)).toBe('teen');
    expect(stageAt(20)).toBe('teen');
    expect(stageAt(21)).toBe('adult');
    expect(stageAt(69)).toBe('adult');
    expect(stageAt(70)).toBe('elderly');
  });

  it('rejects negative ages', () => {
    expect(() => deriveLifecycleStage({ ageMs: -1, policy })).toThrow();
  });
});

describe('resolveAgentLifespanMs', () => {
  it('derives the same lifespan on every call for the same agent', () => {
    const first = resolveAgentLifespanMs({
      agentId: 'agent-a' as AgentId,
      simulationSeedMaterial: 'sim-seed',
      policy,
    });
    const second = resolveAgentLifespanMs({
      agentId: 'agent-a' as AgentId,
      simulationSeedMaterial: 'sim-seed',
      policy,
    });
    expect(first).toBe(second);
  });

  it('keeps the lifespan inside the policy window', () => {
    for (const agentId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const lifespanMs = resolveAgentLifespanMs({
        agentId: agentId as AgentId,
        simulationSeedMaterial: 'sim-seed',
        policy,
      });
      expect(lifespanMs).toBeGreaterThanOrEqual(90 * DAY_MS);
      expect(lifespanMs).toBeLessThanOrEqual(130 * DAY_MS);
    }
  });

  it('differentiates agents and respects the seed material', () => {
    const base = resolveAgentLifespanMs({
      agentId: 'agent-a' as AgentId,
      simulationSeedMaterial: 'sim-seed',
      policy,
    });
    expect(
      resolveAgentLifespanMs({
        agentId: 'agent-b' as AgentId,
        simulationSeedMaterial: 'sim-seed',
        policy,
      }),
    ).not.toBe(base);
    expect(
      resolveAgentLifespanMs({
        agentId: 'agent-a' as AgentId,
        simulationSeedMaterial: 'other-seed',
        policy,
      }),
    ).not.toBe(base);
  });
});

describe('evaluateOldAgeDeath', () => {
  it('fires once the age reaches the pre-rolled lifespan', () => {
    expect(evaluateOldAgeDeath({ ageMs: 100 * DAY_MS, lifespanMs: 100 * DAY_MS })).toBe(
      true,
    );
    expect(
      evaluateOldAgeDeath({ ageMs: 99.999 * DAY_MS, lifespanMs: 100 * DAY_MS }),
    ).toBe(false);
  });
});

describe('calculateIllnessDeathProbabilityPercent', () => {
  it('is zero at or above the health threshold', () => {
    expect(
      calculateIllnessDeathProbabilityPercent({
        health: 30,
        elapsedMs: 3_600_000,
        policy,
      }),
    ).toBe(0);
    expect(
      calculateIllnessDeathProbabilityPercent({
        health: 80,
        elapsedMs: 3_600_000,
        policy,
      }),
    ).toBe(0);
  });

  it('scales quadratically with the normalized health gap and linearly with time', () => {
    const atHealth = (health: number, elapsedMs: number) =>
      calculateIllnessDeathProbabilityPercent({ health, elapsedMs, policy });
    // health 0 → gap 1 → scale × 1 × 1h = 20%/h; health 15 → gap 0.5 → 5%/h.
    expect(atHealth(0, 3_600_000)).toBeCloseTo(20, 10);
    expect(atHealth(15, 3_600_000)).toBeCloseTo(5, 10);
    expect(atHealth(0, 7_200_000)).toBeCloseTo(40, 10);
  });

  it('caps the probability at 100 percent', () => {
    expect(
      calculateIllnessDeathProbabilityPercent({
        health: 0,
        elapsedMs: 100 * 3_600_000,
        policy,
      }),
    ).toBe(100);
  });
});

describe('evaluateIllnessDeath', () => {
  it('dies when the roll falls under the probability', () => {
    expect(
      evaluateIllnessDeath({
        health: 0,
        elapsedMs: 3_600_000,
        roll: 0.199,
        policy,
      }),
    ).toBe(true);
    expect(
      evaluateIllnessDeath({
        health: 0,
        elapsedMs: 3_600_000,
        roll: 0.201,
        policy,
      }),
    ).toBe(false);
  });

  it('never dies at or above the health threshold', () => {
    expect(
      evaluateIllnessDeath({ health: 30, elapsedMs: 3_600_000, roll: 0, policy }),
    ).toBe(false);
  });

  it('rejects rolls outside [0, 1)', () => {
    expect(() =>
      evaluateIllnessDeath({ health: 0, elapsedMs: 3_600_000, roll: 1, policy }),
    ).toThrow('illness death roll must be within [0, 1)');
    expect(() =>
      evaluateIllnessDeath({ health: 0, elapsedMs: 3_600_000, roll: -0.1, policy }),
    ).toThrow();
  });
});

describe('evaluateRetirement', () => {
  it('retires only elderly agents who still hold a job', () => {
    expect(evaluateRetirement({ stage: 'elderly', hasJob: true })).toBe(true);
    expect(evaluateRetirement({ stage: 'elderly', hasJob: false })).toBe(false);
    expect(evaluateRetirement({ stage: 'adult', hasJob: true })).toBe(false);
  });
});

describe('assertValidLifecyclePolicy', () => {
  it('accepts the canonical policy', () => {
    expect(() => assertValidLifecyclePolicy(policy)).not.toThrow();
  });

  it('rejects an empty policyVersion', () => {
    expect(() =>
      assertValidLifecyclePolicy({ ...policy, policyVersion: ' ' }),
    ).toThrow('policyVersion must not be empty');
  });

  it('rejects a non-positive day length', () => {
    expect(() => assertValidLifecyclePolicy({ ...policy, dayLengthMs: 0 })).toThrow(
      'dayLengthMs must be a positive finite number',
    );
  });

  it('rejects non-increasing stage thresholds', () => {
    expect(() =>
      assertValidLifecyclePolicy({
        ...policy,
        stageThresholdsDays: { teen: 30, adult: 21, elderly: 70 },
      }),
    ).toThrow('strictly increasing');
  });

  it('rejects an inverted lifespan window', () => {
    expect(() =>
      assertValidLifecyclePolicy({ ...policy, minLifespanDays: 140 }),
    ).toThrow('minLifespanDays must not exceed maxLifespanDays');
  });

  it('rejects negative risk or pension parameters', () => {
    expect(() => assertValidLifecyclePolicy({ ...policy, pensionPerHour: -1 })).toThrow(
      'pensionPerHour must be non-negative',
    );
    expect(() =>
      assertValidLifecyclePolicy({ ...policy, illnessDeathHealthThreshold: -1 }),
    ).toThrow('illnessDeathHealthThreshold must be non-negative');
  });
});

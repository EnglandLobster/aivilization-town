import { describe, expect, it } from 'vitest';
import {
  applyResidentServiceEffect,
  affordableServiceDuration,
  serviceEffectRequirements,
  residentServiceEffect,
} from './serviceEffects';
const person = { energy: 50, satiety: 50, health: 60, educationScore: 10 };
describe('resident service effects', () => {
  it('uses actual cumulative care time and never lowers already higher body state', () => {
    const a = applyResidentServiceEffect({
      modelId: 'supportive-care-v1',
      previousProgressMs: 0,
      nextProgressMs: 1_800_000,
      provider: person,
      recipient: person,
      educationCeiling: 10,
    });
    expect(a.provider.energy).toBe(45);
    expect(a.recipient.health).toBe(62);
    expect(a.recipient.educationScore).toBe(10);
    const b = applyResidentServiceEffect({
      modelId: 'supportive-care-v1',
      previousProgressMs: 0,
      nextProgressMs: 1_800_000,
      provider: person,
      recipient: { ...person, health: 110 },
      educationCeiling: 10,
    });
    expect(b.recipient.health).toBe(110);
  });
  it('limits teaching to actual knowledge and preserves reusable books', () => {
    expect(serviceEffectRequirements(residentServiceEffect('guided-study-v1')!, 7200000)).toEqual({
      Book: 1,
    });
    const result = applyResidentServiceEffect({
      modelId: 'guided-study-v1',
      previousProgressMs: 0,
      nextProgressMs: 7200000,
      provider: person,
      recipient: { ...person, educationScore: 9 },
      educationCeiling: 10,
    });
    expect(result.recipient.educationScore).toBe(10);
    expect(result.consumed).toEqual({});
    expect(result.recipient.energy).toBe(42);
  });
  it('matches segmented actual meals, consumes only measured food and caps satiety', () => {
    const full = applyResidentServiceEffect({
      modelId: 'meal-assistance-v1',
      previousProgressMs: 0,
      nextProgressMs: 1000000,
      provider: person,
      recipient: person,
      educationCeiling: 10,
    });
    const first = applyResidentServiceEffect({
      modelId: 'meal-assistance-v1',
      previousProgressMs: 0,
      nextProgressMs: 123457,
      provider: person,
      recipient: person,
      educationCeiling: 10,
    });
    const last = applyResidentServiceEffect({
      modelId: 'meal-assistance-v1',
      previousProgressMs: 123457,
      nextProgressMs: 1000000,
      provider: first.provider,
      recipient: first.recipient,
      educationCeiling: 10,
    });
    expect(last.provider).toEqual(full.provider);
    expect(last.recipient).toEqual(full.recipient);
    expect(first.consumed.Apple! + last.consumed.Apple!).toBeCloseTo(full.consumed.Apple!, 9);
  });
  it('rejects unaffordable work and finds only the affordable prefix', () => {
    const input = {
      modelId: 'supportive-care-v1' as const,
      progressMs: 0,
      elapsedMs: 3600000,
      provider: { ...person, energy: 1 },
      recipient: person,
      educationCeiling: 10,
    };
    expect(affordableServiceDuration(input)).toBe(360000);
    expect(() =>
      applyResidentServiceEffect({ ...input, previousProgressMs: 0, nextProgressMs: 3600000 }),
    ).toThrow('service-effort-unaffordable');
    expect(residentServiceEffect('constructor')).toBeUndefined();
  });
});

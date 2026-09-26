import { expect, test } from 'vitest';
import { createAivilizationPopulationScenarioPreset } from './scenarios';
import { initializeResidentPopulation } from './residentInitialization';
test('settled population has deterministic varied starting resources, optional jobs and reciprocal acquaintances without fabricated memories', () => {
  const preset = createAivilizationPopulationScenarioPreset({
    id: 'test',
    name: 'test',
    description: 'test',
    agentCount: 20,
  });
  const a = initializeResidentPopulation(preset, 'one', 'settled'),
    b = initializeResidentPopulation(preset, 'one', 'settled');
  expect(a).toEqual(b);
  expect(a).not.toEqual(initializeResidentPopulation(preset, 'two', 'settled'));
  expect(new Set(Object.values(a.backgrounds)).size).toBeGreaterThan(10);
  expect(a.preset.agentSeeds.some((r) => r.job === null)).toBe(true);
  expect(a.preset.agentSeeds.some((r) => r.job !== null)).toBe(true);
  for (const r of a.preset.agentSeeds) {
    expect(r.balance).toBeGreaterThanOrEqual(300);
    expect(r.inventory.Apple).toBeGreaterThanOrEqual(4);
    expect(r.physiology.energy).toBe(100);
    expect(r.residenceLocationId).toBeTruthy();
    for (const other of a.acquaintances[r.agentId]!)
      expect(a.acquaintances[other]).toContain(r.agentId);
  }
  const newcomers = initializeResidentPopulation(preset, 'one', 'newcomers');
  expect(
    newcomers.preset.agentSeeds.every(
      (r) => r.job === null && Object.keys(r.inventory).length === 0,
    ),
  ).toBe(true);
  expect(Object.values(newcomers.acquaintances).every((ids) => ids.length === 0)).toBe(true);
});

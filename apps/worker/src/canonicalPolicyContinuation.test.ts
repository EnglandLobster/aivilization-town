import { RESIDENT_RHYTHM_POLICY } from '@aivilization/society';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  createAivilizationWorldPolicyManifest,
  createAivilizationWorldCommandPolicies,
} from './aivilizationWorldPolicies';
import {
  resolveCanonicalPolicyContinuation,
  type CanonicalPolicyContinuation,
} from './canonicalPolicyContinuation';
import {
  createOpenSocietyManifest,
  openWorldPolicies,
  serializableWorldPolicy,
} from './openSociety/manifest';
import { OpenSocietyRuntime } from './openSociety/runtime';
function fixture() {
  const manifest = createOpenSocietyManifest({ count: 2, seed: 'policy-source' });
  const configuration = { townWeather: true, townGovernance: true };
  const source: CanonicalPolicyContinuation = {
    version: 'canonical-policy-continuation-v1',
    seed: manifest.seed,
    configuration,
    sourcePolicyManifest: JSON.parse(
      JSON.stringify(createAivilizationWorldPolicyManifest(configuration)),
    ) as Record<string, unknown>,
  };
  return { manifest, source };
}
test('source recipe preserves enabled authority policies and canonical dynamic wage calculation', () => {
  const { manifest, source } = fixture();
  const policies = resolveCanonicalPolicyContinuation(source, manifest.seed, manifest.initialWorld);
  const expected = createAivilizationWorldCommandPolicies(
    manifest.seed,
    undefined,
    source.configuration,
  )(manifest.initialWorld);
  expect(policies.governance).toEqual(expected.governance);
  expect(policies.weather).toBeDefined();
  expect(policies.wageCalculator('Cleaner')).toBe(expected.wageCalculator('Cleaner'));
  expect(policies.wageCalculator('CEO')).toBe(expected.wageCalculator('CEO'));
  expect(policies.laborCost).toEqual(expected.laborCost);
  expect(openWorldPolicies(manifest.seed, manifest.initialWorld).governance).toBeUndefined();
  expect(
    openWorldPolicies(manifest.seed, manifest.initialWorld, undefined, source).governance,
  ).toEqual(expected.governance);
});
test('seed, manifest changes and unknown configuration cannot silently fall back to defaults', () => {
  const { manifest, source } = fixture();
  expect(() =>
    openWorldPolicies(manifest.seed, manifest.initialWorld, RESIDENT_RHYTHM_POLICY, source),
  ).toThrow('canonical-policy-rhythm-transition-required');
  expect(() => resolveCanonicalPolicyContinuation(source, 'other', manifest.initialWorld)).toThrow(
    'identity-mismatch',
  );
  expect(() =>
    resolveCanonicalPolicyContinuation(
      { ...source, sourcePolicyManifest: {} },
      manifest.seed,
      manifest.initialWorld,
    ),
  ).toThrow('manifest-mismatch');
  expect(() =>
    resolveCanonicalPolicyContinuation(
      {
        ...source,
        configuration: { ...source.configuration, unknownPolicy: true },
      } as CanonicalPolicyContinuation,
      manifest.seed,
      manifest.initialWorld,
    ),
  ).toThrow('configuration-unmapped');
});
test('runtime uses the persisted source through advance, restart and replay', () => {
  const { manifest, source } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'canonical-policy-continuity-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    const candidate = {
      ...manifest,
      canonicalPolicyContinuation: source,
      provenance: { ...manifest.provenance, worldPolicyAdapter: source.version },
      worldPolicies: serializableWorldPolicy(
        manifest.seed,
        manifest.initialWorld,
        undefined,
        source,
      ),
    };
    runtime = new OpenSocietyRuntime(root, candidate);
    expect(runtime.advanceTime(1000, 'advance-source').ok).toBe(true);
    const state = structuredClone(runtime.state);
    runtime.close();
    runtime = new OpenSocietyRuntime(root);
    expect(runtime.state).toEqual(state);
    expect(runtime.manifest.canonicalPolicyContinuation).toEqual(source);
    expect(runtime.advanceTime(1000, 'advance-next').ok).toBe(true);
    expect(runtime.state.world.clock.now).toBe(manifest.initialWorld.clock.now + 2000);
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test('invalid persisted policy source closes writer ownership even when recipe validation throws', () => {
  const { manifest, source } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'canonical-policy-rejected-'));
  try {
    const candidate = {
      ...manifest,
      canonicalPolicyContinuation: { ...source, sourcePolicyManifest: {} },
      provenance: { ...manifest.provenance, worldPolicyAdapter: source.version },
    };
    expect(() => new OpenSocietyRuntime(root, candidate)).toThrow(
      'canonical-policy-source-manifest-mismatch',
    );
    expect(() => new OpenSocietyRuntime(root)).toThrow('canonical-policy-source-manifest-mismatch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

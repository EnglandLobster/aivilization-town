import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import {
  activateSocietyFoundations,
  activateSocietyServices,
  activateSocietyBodyLearning,
  activateSocietyLivelihoods,
} from './societyActivation';
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'society-foundations-'));
  roots.push(root);
  const manifest = createOpenSocietyManifest({ count: 2, life: false, societyKernel: false });
  return { root, manifest, runtime: new OpenSocietyRuntime(root, manifest) };
}
test('explicit activation preserves original assets and identities, reports live availability and replays', () => {
  const f = fixture();
  let runtime = f.runtime;
  try {
    const before = structuredClone(runtime.state.world);
    expect(runtime.discover('stocks.list').tools[0]?.availability.adapterEnabled).toBe(false);
    expect(activateSocietyFoundations(runtime).status).toBe('enabled');
    expect(runtime.discover('stocks.list').tools[0]?.availability.adapterEnabled).toBe(true);
    expect(runtime.state.world.agents).toEqual(before.agents);
    expect(runtime.state.world.moneySupply).toBe(before.moneySupply);
    expect(runtime.discover('sources.list').tools[0]?.availability.adapterEnabled).toBe(false);
    expect(runtime.state.world.materials?.stocks).toEqual({});
    expect(runtime.state.world.premises?.sites).toEqual({});
    const state = structuredClone(runtime.state);
    const count = runtime.journal.commits.length;
    expect(activateSocietyFoundations(runtime).status).toBe('enabled');
    expect(runtime.journal.commits).toHaveLength(count);
    runtime.close();
    runtime = new OpenSocietyRuntime(f.root);
    expect(runtime.state).toEqual(state);
    expect(runtime.discover('stocks.list').tools[0]?.availability.adapterEnabled).toBe(true);
  } finally {
    runtime.close();
  }
});
test('active resident turn blocks activation; rejected phase stops and resumes without duplicate steps', () => {
  const f = fixture();
  const r = f.runtime;
  try {
    const actor = f.manifest.residents[0]!.id;
    r.beginTurn(actor);
    const count = r.journal.commits.length;
    expect(activateSocietyFoundations(r)).toMatchObject({
      status: 'blocked',
      reason: 'resident-turn-active',
    });
    expect(r.journal.commits).toHaveLength(count);
    r.finishTurn(actor, { summary: 'test' });
    const hook = vi.spyOn(r, 'enableMaterials').mockReturnValueOnce({
      ok: false,
      error: 'injected-material-refusal',
      revision: r.state.revision,
      simulationTime: r.state.world.clock.now,
    });
    expect(activateSocietyFoundations(r)).toMatchObject({
      status: 'blocked',
      reason: 'materials:injected-material-refusal',
    });
    expect(r.state.world.premises).toBeUndefined();
    const prefix = r.journal.commits.map((c) => c.hash);
    hook.mockRestore();
    expect(activateSocietyFoundations(r).status).toBe('enabled');
    expect(r.journal.commits.slice(0, prefix.length).map((c) => c.hash)).toEqual(prefix);
  } finally {
    r.close();
  }
});

test('service directory phase upgrades explicitly, creates no providers and replays every activation', () => {
  const f = fixture();
  let r = f.runtime;
  try {
    expect(activateSocietyServices(r)).toMatchObject({
      status: 'blocked',
      reason: 'providers:services-not-enabled',
    });
    expect(activateSocietyFoundations(r).status).toBe('enabled');
    expect(activateSocietyServices(r)).toMatchObject({
      status: 'blocked',
      reason: 'public-governance-not-enabled',
    });
    expect(r.enablePublicGovernance().ok).toBe(true);
    const before = structuredClone(r.state.world);
    const result = activateSocietyServices(r);
    expect(result.status, JSON.stringify(result)).toBe('enabled');
    expect(r.state.services?.policy.version).toBe('resident-services-v3');
    expect(r.state.services?.services).toEqual({});
    expect(r.state.services?.bookings).toEqual({});
    expect(r.state.services?.relationPolicy).toBeDefined();
    expect(r.state.world.agents).toEqual(before.agents);
    expect(r.state.world.moneySupply).toBe(before.moneySupply);
    expect(r.state.world.activityTimeByAgent).toEqual(before.activityTimeByAgent);
    const state = structuredClone(r.state);
    const count = r.journal.commits.length;
    expect(activateSocietyServices(r).status).toBe('enabled');
    expect(r.journal.commits).toHaveLength(count);
    r.close();
    r = new OpenSocietyRuntime(f.root);
    expect(r.state).toEqual(state);
  } finally {
    r.close();
  }
});

test('body/learning phase preserves original bodies and balances and replays without inferred labor terms', () => {
  const f = fixture();
  let r = f.runtime;
  try {
    const before = structuredClone(r.state.world);
    const result = activateSocietyBodyLearning(r);
    expect(result.status, JSON.stringify(result)).toBe('enabled');
    expect(r.state.world.agents).toEqual(before.agents);
    expect(r.state.world.moneySupply).toBe(before.moneySupply);
    expect(r.state.world.residentLabor).toBeUndefined();
    expect(r.state.world.residentRest).toBeDefined();
    expect(r.state.world.residentStudy).toBeDefined();
    const count = r.journal.commits.length;
    expect(activateSocietyBodyLearning(r).status).toBe('enabled');
    expect(r.journal.commits).toHaveLength(count);
    const state = structuredClone(r.state);
    r.close();
    r = new OpenSocietyRuntime(f.root);
    expect(r.state).toEqual(state);
  } finally {
    r.close();
  }
});

test('livelihood activation preserves its completed prefix and never selects missing wage terms', () => {
  const f = fixture();
  const r = f.runtime;
  try {
    expect(activateSocietyFoundations(r).status).toBe('enabled');
    expect(activateSocietyBodyLearning(r).status).toBe('enabled');
    const result = activateSocietyLivelihoods(r);
    expect(result.status).toBe('blocked');
    expect(result.completed).toEqual(['service-engagements', 'service-time']);
    expect(result.reason).toContain('service-employment:');
    expect(r.state.world.residentLabor).toBeUndefined();
    expect(r.state.world.productiveEmployment).toBeUndefined();
    const prefix = r.journal.commits.map((c) => c.hash);
    expect(r.enableAgreedLabor().ok).toBe(true);
    expect(activateSocietyLivelihoods(r).status).toBe('enabled');
    expect(r.journal.commits.slice(0, prefix.length).map((c) => c.hash)).toEqual(prefix);
  } finally {
    r.close();
  }
});

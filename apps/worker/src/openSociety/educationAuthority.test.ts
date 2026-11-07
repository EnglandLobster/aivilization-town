import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asLocationId, createCommandEnvelope, createEventEnvelope } from '@aivilization/sim-core';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  enableEducationAuthorityEvent,
} from '@aivilization/world';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, openWorldPolicies } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true) {
  const m = createOpenSocietyManifest({
    count: 4,
    continuity: true,
    elapsedRest: true,
    elapsedStudy: true,
    educationAuthority: enabled,
    initialization: 'newcomers',
  });
  const actor = m.residents[2]!.id;
  expect(m.initialWorld.agents[actor]!.educationScore).toBe(160);
  const root = mkdtempSync(join(tmpdir(), 'education-authority-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const world = {
    ...m.initialWorld,
    agents: {
      ...m.initialWorld.agents,
      [actor]: { ...m.initialWorld.agents[actor]!, locationId: asLocationId('school'), job: null },
    },
  };
  const r = new OpenSocietyRuntime(root, { ...m, initialWorld: world });
  cleanup.push(() => r.close());
  let n = 0;
  const call = (name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId: `qualification-${++n}` });
    r.finishTurn(actor, { summary: 'Directed qualification boundary verification' });
    return v;
  };
  const study = () => {
    const result = call('world.study', { durationSeconds: 1300 });
    expect(result.ok, result.error).toBe(true);
    expect(r.advanceTime(1300000, `elapsed-${++n}`).ok).toBe(true);
    expect(r.state.world.agents[actor]!.educationScore).toBeGreaterThan(180);
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { m, r, root, actor, call, study, replay };
}
test('real newcomer learning crosses the threshold without inventing an admission; actual exam settlement grants the grade', () => {
  const t = fixture();
  t.study();
  expect(t.r.state.world.agents[t.actor]!.educationLevel).toBe(2);
  const self = t.call('world.observe', { view: 'qualifications' });
  expect(self.data).toMatchObject({
    educationLevel: 2,
    origin: { source: 'scenario-initial-qualification', level: 2 },
  });
  const index = t.call('world.observe', { view: 'rules', section: 'index' });
  const sections = (index.data as { sections: readonly { name: string; readWith: string }[] }).sections;
  expect(sections.find(s => s.name === 'occupations')?.readWith).toBe('town city observe --view rules --section occupations');
  expect(t.call('world.observe', { view: 'rules', section: 'education' }).ok).toBe(true);
  const exam = t.call('world.apply_exam', { targetLevel: 3 });
  expect(exam.ok, exam.error).toBe(true);
  expect(t.r.state.world.agents[t.actor]!.educationLevel).toBe(2);
  expect(t.call('world.apply_exam', { targetLevel: 3 }).ok).toBe(false);
  const end = t.r.state.world.educationAuthority!.institution.examCycleDurationMs;
  const settled = t.r.advanceTime(end - t.r.state.world.clock.now, 'exam-cycle');
  expect(settled.ok, settled.error).toBe(true);
  expect(t.r.state.world.agents[t.actor]!.educationLevel).toBe(3);
  expect(t.r.state.world.educationExamApplications).toEqual([
    expect.objectContaining({ agentId: t.actor, status: 'admitted' }),
  ]);
  t.replay();
}, 30000);
test('authority refuses forged initial recognition, unearned promotion and changed policy; registration records its own initial grade', () => {
  const legacy = fixture(false),
    t = fixture();
  const policies = openWorldPolicies(legacy.m.seed, legacy.r.state.world, legacy.m.rhythm);
  const event = enableEducationAuthorityEvent({
    projection: legacy.r.state.world,
    policies,
    mode: 'legacy',
    simulationId: 'test',
    requestId: 'enable',
    nextSequence: 1,
  });
  if (event.type !== 'ResidentEducationAuthorityEnabled') throw Error('unexpected-event');
  const origin = event.payload.origins[legacy.actor]!;
  expect(() =>
    applyWorldEvent(legacy.r.state.world, {
      ...event,
      payload: {
        ...event.payload,
        origins: { ...event.payload.origins, [legacy.actor]: { ...origin, level: 5 } },
      },
    }),
  ).toThrow('invalid-qualification-origin');
  const w = t.r.state.world;
  const promotion = createEventEnvelope({
    id: 'forged',
    simulationId: 'test',
    sequence: 1,
    occurredAt: w.clock.now,
    type: 'EducationLevelChanged',
    payload: {
      agentId: w.agents[t.actor]!.agentId,
      previousLevel: 2,
      nextLevel: 3,
      reason: 'education-exam-admission:cycle-0',
    } as const,
  });
  expect(() => applyWorldEvent(w, promotion)).toThrow(
    'formal-promotion-requires-recorded-admission',
  );
  const command = createCommandEnvelope({
    id: 'registration',
    simulationId: 'test',
    actorId: 'new-person',
    issuedAt: w.clock.now,
    type: 'RegisterAgent',
    payload: { agentId: 'new-person', creatorId: 'test', displayName: 'New resident' },
  });
  const currentPolicies = openWorldPolicies(t.m.seed, w, t.m.rhythm);
  expect(() =>
    dispatchWorldCommand({
      command,
      projection: w,
      policies: {
        ...currentPolicies,
        educationSystem: { ...currentPolicies.educationSystem!, enabled: false },
      },
      nextSequence: 1,
    }),
  ).toThrow('education-institution-policy-mismatch');
  const events = dispatchWorldCommand({
    command,
    projection: w,
    policies: currentPolicies,
    nextSequence: 1,
  });
  expect(events[0]?.type).toBe('AgentRegistered');
  const registered = events.reduce(applyWorldEvent, w);
  expect(registered.agents['new-person']).toMatchObject({
    educationLevel: 0,
    qualificationOrigin: { source: 'registration-initial-qualification', level: 0 },
  });
  const registeredEvent = events[0]!;
  if (registeredEvent.type !== 'AgentRegistered') throw Error('unexpected-event');
  expect(() =>
    applyWorldEvent(w, {
      ...registeredEvent,
      payload: {
        ...registeredEvent.payload,
        initialState: { ...registeredEvent.payload.initialState, educationLevel: 5 },
      },
    }),
  ).toThrow();
});

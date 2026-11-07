// Analyze one journal suffix after the sole daemon has stopped. Never infer social success from counts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const [rootArg, beforePath, logPath, output] = process.argv.slice(2);
assert.ok(
  rootArg && beforePath && logPath && output,
  'root before-json daemon-log output-json required',
);
const root = resolve(rootArg);
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const logs = readFileSync(logPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const finish = logs.findLast((x) => x.event === 'resident-society-finished');
assert.ok(finish, 'daemon-has-no-terminal-result');
const bytes = readFileSync(join(root, 'journal.jsonl'));
assert.equal(bytes.at(-1), 10, 'incomplete-journal-line');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const prefix = bytes.toString('utf8').split('\n').slice(0, before.revision).join('\n') + '\n';
assert.equal(hash(prefix), before.journalHash, 'historical-prefix-changed');
const count = (items, key) => {
  const result = {};
  for (const item of items) {
    const name = key(item);
    result[name] = (result[name] ?? 0) + 1;
  }
  return result;
};
// Runtime acquires the writer lock; a terminal log alone never authorizes concurrent state access.
let runtime = new OpenSocietyRuntime(root);
let report;
try {
  const state = structuredClone(runtime.state);
  const commits = runtime.journal.commits.filter((c) => c.sequence > before.revision);
  const residents = new Set(before.residents.map((r) => r.actorId));
  const calls = commits.filter(
    (c) => residents.has(c.actorId) && !c.capability.startsWith('turn.'),
  );
  const starts = commits.filter((c) => c.capability === 'turn.started');
  const ends = commits.filter((c) => c.capability === 'turn.finished');
  assert.equal(starts.length, ends.length, 'unfinished-resident-turn');
  assert.equal(ends.length, finish.opportunities, 'daemon-and-journal-opportunities-differ');
  const provider = starts.map((c) => {
    const turnId = c.requestId;
    const path = join('opencode', c.actorId, `${turnId}.json`);
    const data = readFileSync(join(root, path));
    const p = JSON.parse(data.toString('utf8'));
    assert.equal(p.mode, 'free');
    assert.equal(p.task, 'free-activity');
    assert.equal(p.turnId, turnId);
    return {
      path,
      sha256: hash(data),
      actorId: c.actorId,
      turnId,
      model: p.model,
      skillVersion: p.skillVersion,
      status: p.status,
      termination: p.termination ?? null,
      elapsedMs: p.elapsedMs,
      sessionId: p.sessionId,
      toolResults: p.events
        .filter((e) => e.type === 'tool_use')
        .map((e) => ({
          tool: e.part?.tool,
          status: e.part?.state?.status,
          exitCode: Number.isSafeInteger(e.part?.state?.metadata?.exit)
            ? e.part.state.metadata.exit
            : null,
        })),
      // Categories may overlap; do not invent a total from provider counters.
      usage: p.events
        .filter((e) => e.type === 'step_finish')
        .map((e) => ({ tokens: e.part?.tokens ?? null, cost: e.part?.cost ?? null })),
    };
  });
  const events = commits.flatMap((c) =>
    Object.entries(c)
      .filter(([key, value]) => key.endsWith('Events') && Array.isArray(value))
      .flatMap(([family, values]) =>
        values.map((event) => ({ sequence: c.sequence, family, event })),
      ),
  );
  const worldEvents = commits.flatMap((c) => c.worldEvents ?? []);
  const materialReceipts = worldEvents
    .filter((e) => e.type === 'ResidentMaterialsCommitted')
    .flatMap((e) =>
      e.payload.events.filter((v) => v.type === 'MaterialReceiptRecorded').map((v) => v.receipt),
    );
  const productions = Object.values(state.world.materials?.productions ?? {}).map((p) => ({
    id: p.id,
    status: p.status,
    progressMs: p.progressMs,
    completed: p.completed,
    session: p.session ?? null,
  }));
  const beforeById = new Map(before.productions.map((p) => [p.id, p]));
  report = {
    version: 'resident-continuous-phase-observation-v1',
    mode: 'unprompted-existing-world',
    finish,
    beforeRevision: before.revision,
    afterRevision: state.revision,
    beforeClock: before.clock,
    afterClock: state.world.clock.now,
    simulationElapsedMs: state.world.clock.now - before.clock,
    journalHash: hash(bytes),
    historicalPrefixPreserved: true,
    opportunities: ends.length,
    distinctResidents: new Set(starts.map((c) => c.actorId)).size,
    turnCounts: count(starts, (c) => c.actorId),
    capabilityCounts: count(
      calls,
      (c) => `${c.capability}/${c.result.ok ? 'accepted' : 'refused'}`,
    ),
    refusals: calls
      .filter((c) => !c.result.ok)
      .map((c) => ({
        sequence: c.sequence,
        actorId: c.actorId,
        capability: c.capability,
        error: c.result.error,
      })),
    eventCounts: count(events, (x) => `${x.family}/${x.event.type}`),
    materialOperations: count(materialReceipts, (r) => r.operation),
    productionChanges: productions
      .filter((p) => JSON.stringify(p) !== JSON.stringify(beforeById.get(p.id)))
      .map((p) => ({ before: beforeById.get(p.id) ?? null, after: p })),
    newMaterialConversions: materialReceipts.flatMap((r) =>
      (r.conversions ?? []).map((c) => ({ receiptId: r.id, operation: r.operation, ...c })),
    ),
    residents: before.residents.map((b) => ({
      actorId: b.actorId,
      beforeLastTurnOrdinal: b.lastTurnOrdinal,
      afterLastTurnOrdinal: state.residents[b.actorId]?.lastTurnOrdinal ?? null,
      nextWakeAt: state.residents[b.actorId]?.nextWakeAt ?? null,
    })),
    provider,
    limitations: [
      'Facts cover this suffix only; existing institutions and assets are not new emergent outcomes.',
      'Counts, names and model text do not prove cooperation or stable institutions.',
      'A travel start is not arrival; enrollment is not completed learning.',
      'Provider token categories are preserved separately and may overlap.',
    ],
  };
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  report.replayMatched = true;
  report.reopenDidNotAppend = true;
} finally {
  runtime.close();
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      finish: report.finish,
      opportunities: report.opportunities,
      distinctResidents: report.distinctResidents,
      simulationElapsedMs: report.simulationElapsedMs,
      refusals: report.refusals,
      eventCounts: report.eventCounts,
      replayMatched: report.replayMatched,
    },
    null,
    2,
  ),
);

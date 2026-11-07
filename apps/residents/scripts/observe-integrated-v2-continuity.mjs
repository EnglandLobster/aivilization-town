// Unprompted conditions observation with clean daemon restart and live transport replica validation.
// This is neither crash/SIGKILL recovery nor a scripted social outcome test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createIntegratedSocietyManifest,
  INTEGRATED_SOCIETY_PROFILE_V2,
  OpenSocietyRuntime,
  SocietyCommitReplica,
} from '@aivilization/worker';
import {
  startResidentSocietyDaemon,
  loadResidentCredentials,
  townRequest,
  residentReport,
  syncSocietyReplica,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/integrated-v2-conditions');
assert.equal(existsSync(root), false, 'fresh-directory-required');
mkdirSync(root, { recursive: true, mode: 0o700 });
const model = 'opencode-go/deepseek-v4.1-flash',
  seed = 'integrated-v2-conditions-20261007';
const digest = (b) => createHash('sha256').update(b).digest('hex');
const save = (dir, name, value) =>
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
function compiledHashes() {
  const paths = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) paths.push(p);
    }
  };
  for (const parent of ['apps', 'packages'])
    for (const name of readdirSync(parent)) {
      const d = join(parent, name, 'dist');
      if (existsSync(d)) walk(d);
    }
  return Object.fromEntries(paths.sort().map((p) => [p, digest(readFileSync(p))]));
}
const compiledBefore = compiledHashes();
const plan = {
  mode: 'unprompted-v2-conditions-clean-restart',
  profile: INTEGRATED_SOCIETY_PROFILE_V2,
  model,
  seed,
  residents: 4,
  conditions: ['settled', 'newcomers'],
  segmentsPerCondition: 2,
  opportunitiesPerSegment: 8,
  timeoutMs: 300000,
  compiledBefore,
  limitations: [
    'bundled existing initialization differences, not a single-variable causal experiment',
    'finite observation does not establish stable emergence',
    'initial backgrounds, public institutions and assets are external seeds',
    'clean stop between opportunities, not crash recovery',
    'no tasks, desired organizations or injected collaboration messages',
    'provider failure retained and stops this experiment without retry',
  ],
};
save(root, 'observation-plan.json', plan);
const results = [];
let failure;
try {
  for (const initialization of plan.conditions) {
    const worldRoot = join(root, initialization);
    mkdirSync(worldRoot, { mode: 0o700 });
    const manifest = createIntegratedSocietyManifest({
      count: 4,
      seed,
      initialization,
      profile: INTEGRATED_SOCIETY_PROFILE_V2,
    });
    const initialized = new OpenSocietyRuntime(worldRoot, manifest);
    initialized.close();
    const manifestBytes = readFileSync(join(worldRoot, 'manifest.json'));
    const credentials = loadResidentCredentials(
      worldRoot,
      manifest.residents.map((r) => r.id),
    );
    let previousJournal = Buffer.alloc(0),
      previousState;
    const segments = [];
    for (let segment = 1; segment <= plan.segmentsPerCondition; segment++) {
      if (previousState) {
        const pre = new OpenSocietyRuntime(worldRoot);
        try {
          assert.deepEqual(pre.state, previousState);
          assert.deepEqual(readFileSync(join(worldRoot, 'journal.jsonl')), previousJournal);
        } finally {
          pre.close();
        }
      }
      console.log(JSON.stringify({ condition: initialization, segment, status: 'starting' }));
      const application = await startResidentSocietyDaemon({
        root: worldRoot,
        port: 0,
        model,
        maxOpportunities: plan.opportunitiesPerSegment,
        timeoutMs: plan.timeoutMs,
        onProgress: (e) =>
          console.log(JSON.stringify({ condition: initialization, segment, ...e })),
      });
      let outcome, live, replicaState, replication;
      try {
        outcome = await application.done;
        live = await townRequest(
          { endpoint: application.url, token: credentials.admin },
          '/admin/report',
        );
        save(worldRoot, `report-segment-${segment}.json`, live);
        save(worldRoot, 'report.json', live);
        replication = await syncSocietyReplica({
          endpoint: application.url,
          token: credentials.admin,
          root: join(worldRoot, 'replica'),
          maxPages: 64,
        });
        assert.equal(replication.status, 'caught-up');
        const replica = new SocietyCommitReplica(join(worldRoot, 'replica'));
        try {
          replicaState = structuredClone(replica.state);
        } finally {
          replica.close();
        }
      } finally {
        await application.stop();
      }
      const bytes = readFileSync(join(worldRoot, 'journal.jsonl')),
        reopened = new OpenSocietyRuntime(worldRoot);
      try {
        assert.deepEqual(readFileSync(join(worldRoot, 'manifest.json')), manifestBytes);
        assert.ok(
          bytes.subarray(0, previousJournal.length).equals(previousJournal),
          'committed-prefix-changed',
        );
        assert.deepEqual(JSON.parse(JSON.stringify(residentReport(reopened))), live);
        assert.deepEqual(
          reopened.state,
          replicaState,
          'live-transport-replica-not-equal-to-reopened-authority',
        );
        assert.deepEqual(readFileSync(join(worldRoot, 'journal.jsonl')), bytes);
        const resumed = [];
        if (previousState) {
          const known = new Map();
          for (const t of Object.values(previousState.turns))
            if (t.sessionId) known.set(t.actorId, t.sessionId);
          for (const t of Object.values(reopened.state.turns)) {
            if (previousState.turns[t.id]) continue;
            const prior = known.get(t.actorId);
            if (prior && t.status !== 'provider-error') {
              assert.equal(t.sessionId, prior, 'provider-session-not-resumed');
              resumed.push({ actorId: t.actorId, turnId: t.id, sessionId: t.sessionId });
            }
            if (t.sessionId) known.set(t.actorId, t.sessionId);
          }
        }
        const record = {
          segment,
          outcome,
          replication,
          simulationTime: reopened.state.world.clock.now,
          liveReportEqualsReplay: true,
          liveTransportReplicaEqualsReopenedAuthority: true,
          manifestUnchanged: true,
          journalUnchangedOnReplay: true,
          committedPrefixUnchanged: true,
          journalSha256: digest(bytes),
          fullStateSha256: digest(JSON.stringify(reopened.state)),
          resumedSessions: resumed,
        };
        segments.push(record);
        save(worldRoot, 'verification.json', { initialization, segments });
        previousJournal = bytes;
        previousState = structuredClone(reopened.state);
      } finally {
        reopened.close();
      }
      assert.deepEqual(
        compiledHashes(),
        compiledBefore,
        'compiled-code-changed-during-observation',
      );
      console.log(
        JSON.stringify({ condition: initialization, segment, status: 'verified', ...outcome }),
      );
      if (outcome.status === 'provider-error')
        throw Error(`provider-error:${initialization}:${segment}`);
    }
    results.push({ initialization, segments });
    save(root, 'conditions.json', results);
  }
} catch (e) {
  failure = e instanceof Error ? e.message : String(e);
}
const verification = {
  passed: !failure,
  plan,
  results,
  compiledAfter: compiledHashes(),
  compiledUnchanged: JSON.stringify(compiledHashes()) === JSON.stringify(compiledBefore),
  ...(failure ? { failure } : {}),
};
save(root, 'verification.json', verification);
console.log(
  JSON.stringify({
    status: 'finished',
    passed: !failure,
    conditions: results.length,
    ...(failure ? { failure } : {}),
  }),
);
if (failure) process.exitCode = 1;

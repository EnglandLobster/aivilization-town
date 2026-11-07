// Read-only evidence analysis after the sole writer has stopped. No desired social outcome is asserted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
import { residentReport } from '../dist/index.js';

const root = resolve(process.argv[2] ?? '.local/open-residents/society-free-20261005');
const output = process.argv[3];
const bytes = readFileSync(join(root, 'journal.jsonl'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const runtime = new OpenSocietyRuntime(root);
try {
  const report = residentReport(runtime);
  assert.deepEqual(
    JSON.parse(JSON.stringify(report)),
    JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')),
  );
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  const commits = runtime.journal.commits;
  const count = (items, key) => {
    const result = {};
    for (const item of items) {
      const name = key(item);
      result[name] = (result[name] ?? 0) + 1;
    }
    return result;
  };
  const residentIds = new Set(runtime.manifest.residents.map((r) => r.id));
  const calls = commits.filter(
    (c) => residentIds.has(c.actorId) && !c.capability.startsWith('turn.'),
  );
  const provider = report.turns.map((turn) => {
    const path = join('opencode', turn.actorId, `${turn.id}.json`);
    if (!existsSync(join(root, path))) {
      const recoveryPath = join('recovery', `${turn.id}.json`);
      const recoveryBytes = readFileSync(join(root, recoveryPath));
      const recovery = JSON.parse(recoveryBytes.toString('utf8'));
      assert.equal(recovery.schemaVersion, 'resident-driver-interruption-recovery-v1');
      assert.equal(recovery.evidenceSource, 'operator-recovery');
      assert.equal(recovery.turnId, turn.id);
      assert.equal(recovery.actorId, turn.actorId);
      assert.equal(turn.status, 'provider-error');
      assert.equal(recovery.status, turn.status);
      assert.equal(recovery.providerArtifactMissing, true);
      return {
        path: recoveryPath,
        sha256: digest(recoveryBytes),
        actorId: turn.actorId,
        turnId: turn.id,
        evidenceSource: 'operator-recovery',
        providerArtifactMissing: true,
        status: turn.status,
        simulationTimeAtStart: recovery.simulationTimeAtStart,
        sessionId: recovery.sessionId,
        completedModelSteps: null,
        usage: null,
        tools: null,
        retainedCalls: recovery.retainedCalls,
        reason: recovery.reason,
      };
    }
    const evidence = JSON.parse(readFileSync(join(root, path), 'utf8'));
    assert.equal(evidence.mode, 'free');
    assert.equal(evidence.task, 'free-activity');
    assert.equal(evidence.turnId, turn.id);
    const steps = evidence.events.filter((e) => e.type === 'step_finish');
    return {
      path,
      sha256: digest(readFileSync(join(root, path))),
      actorId: turn.actorId,
      turnId: turn.id,
      mode: evidence.mode,
      model: evidence.model,
      openCodeVersion: evidence.openCodeVersion,
      transport: evidence.transport,
      skillVersion: evidence.skillVersion,
      status: evidence.status,
      elapsedMs: evidence.elapsedMs,
      simulationTimeAtStart: evidence.context.simulationTime,
      sessionId: evidence.sessionId,
      completedModelSteps: steps.length,
      // Provider token categories may overlap; retain the original values, do not invent a total.
      usage: steps.map((step) => ({
        id: step.part?.id ?? null,
        tokens: step.part?.tokens ?? null,
        cost: step.part?.cost ?? null,
      })),
      tools: evidence.events
        .filter((e) => e.type === 'tool_use')
        .map((e) => ({
          tool: e.part?.tool,
          command: e.part?.state?.input?.command ?? null,
          status: e.part?.state?.status ?? null,
          // Provider 'completed' means the tool returned, not that the CLI succeeded.
          exitCode: Number.isSafeInteger(e.part?.state?.metadata?.exit)
            ? e.part.state.metadata.exit
            : null,
          outputTruncated:
            typeof e.part?.state?.metadata?.truncated === 'boolean'
              ? e.part.state.metadata.truncated
              : null,
        })),
    };
  });
  const events = commits.flatMap((c) =>
    Object.entries(c)
      .filter(([key, value]) => key.endsWith('Events') && Array.isArray(value))
      .flatMap(([family, values]) =>
        values.map((event) => ({ sequence: c.sequence, family, type: event.type })),
      ),
  );
  const state = runtime.state;
  const evidence = {
    schemaVersion: 'society-free-observation-v1',
    mode: 'unprompted-social-outcomes-free-activity',
    root,
    journalSha256: digest(bytes),
    manifestSha256: digest(readFileSync(join(root, 'manifest.json'))),
    implementation: existsSync(join(root, 'implementation.json'))
      ? JSON.parse(readFileSync(join(root, 'implementation.json'), 'utf8'))
      : null,
    // Preserve the original engine evidence; later explicit upgrades are separate phases.
    implementationPhases: existsSync(join(root, 'implementation-phases.json'))
      ? JSON.parse(readFileSync(join(root, 'implementation-phases.json'), 'utf8'))
      : [],
    replayMatchesSavedReport: true,
    replayLeavesJournalBytesUnchanged: true,
    simulationTime: report.simulationTime,
    journalCommits: commits.length,
    opportunities: count(report.turns, (t) => `${t.actorId}/${t.status}`),
    capabilityCalls: calls.length,
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
    eventCounts: count(events, (e) => `${e.family}/${e.type}`),
    initialResidents: Object.values(runtime.manifest.initialWorld.agents).map((a) => ({
      id: a.agentId,
      balance: a.balance,
      inventory: a.inventory,
      job: a.job,
      educationScore: a.educationScore,
      locationId: a.locationId,
      residenceLocationId: a.residenceLocationId,
    })),
    initialization: runtime.manifest.initialization,
    policy: runtime.manifest.policy,
    provenance: runtime.manifest.provenance,
    residentAuthored: {
      spaces: report.spaces.filter((s) => residentIds.has(s.ownerId)),
      documents: report.documents
        .filter((d) => residentIds.has(d.authorId))
        .map(({ content: _content, ...metadata }) => {
          void _content;
          return metadata;
        }),
      messages: report.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        recipientId: m.recipientId,
        sentAt: m.sentAt,
        readAt: m.readAt ?? null,
      })),
      // Object identity and counts describe observed artifacts, not social success or consensus.
      groups: Object.values(state.communication?.groups ?? {}),
      collectives: Object.keys(state.collectives?.charters ?? {}),
      registers: Object.keys(state.sharedRecords?.registers ?? {}),
      views: Object.keys(state.recordViews?.views ?? {}),
      programs: Object.keys(state.coordination?.programs ?? {}),
      services: Object.keys(state.services?.services ?? {}),
    },
    commandOutcomes: {
      // Missing provider metadata remains unknown; journal refusals are a separate layer.
      succeeded: provider.flatMap((p) => p.tools ?? []).filter((t) => t.exitCode === 0).length,
      failed: provider
        .flatMap((p) => p.tools ?? [])
        .filter((t) => t.exitCode !== null && t.exitCode !== 0).length,
      unknown: provider.flatMap((p) => p.tools ?? []).filter((t) => t.exitCode === null).length,
    },
    provider,
    limitations: [
      'Short, single-seed observation; no claim of stable society or general emergence.',
      'Map, public services, markets, initial assets and backgrounds are external initial conditions.',
      'No organization, partner or transaction was specified in the free task; provider system rules still constrain transport and truthful reporting.',
      'Provider usage is reported evidence, not independently verified billing; incomplete model steps are not counted as completed calls.',
      'Replay comparison covers the saved administrator report, not an independently captured full live-world snapshot.',
      'Absence of a capability in this sample is not proof that it is unnecessary.',
    ],
  };
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) writeFileSync(resolve(output), json);
  console.log(json);
} finally {
  runtime.close();
}

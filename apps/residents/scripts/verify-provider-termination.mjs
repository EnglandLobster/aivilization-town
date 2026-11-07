// Controlled process diagnostics; no upstream model and no claim of autonomous behavior.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOpenCodeResidentDriver } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-provider-termination-'));
const executable = join(root, 'fake-provider.mjs');
const token = 'explicit-test-token-not-a-real-credential';
writeFileSync(
  executable,
  `#!${process.execPath}
if(process.argv.includes('--version')) { console.log('controlled-fixture'); process.exit(0); }
const mode=process.argv[process.argv.indexOf('--model')+1];
const emit=value=>console.log(JSON.stringify(value));
emit({type:'text',sessionID:'fixture-session',part:{text:'Original public text'}});
if(mode==='fixture/error') { emit({type:'error',sessionID:'fixture-session',error:{name:'FixtureError'}}); process.stderr.write(process.env.TOWN_RESIDENT_TOKEN); }
if(mode==='fixture/nonzero') process.exitCode=7;
if(mode==='fixture/timeout') setInterval(()=>{},1000);
`,
  { mode: 0o700 },
);
const results = [];
try {
  for (const kind of ['normal', 'error', 'nonzero', 'timeout']) {
    const directory = join(root, kind);
    const driver = createOpenCodeResidentDriver({
      connection: { endpoint: 'http://127.0.0.1:1', token },
      directory,
      executable,
      model: `fixture/${kind}`,
    });
    const result = await driver.run({
      actorId: 'a',
      turnId: kind,
      context: {},
      signal: kind === 'timeout' ? globalThis.AbortSignal.timeout(1500) : new globalThis.AbortController().signal,
      invoke: async () => {
        throw Error('Fixture must not execute a resident action');
      },
    });
    const bytes = readFileSync(join(directory, `${kind}.json`), 'utf8');
    const evidence = JSON.parse(bytes);
    assert.equal(result.status, kind === 'normal' ? 'completed' : 'provider-error');
    assert.equal(evidence.termination.aborted, kind === 'timeout');
    assert.equal(evidence.termination.providerErrorEvent, kind === 'error');
    assert.equal(evidence.termination.abortReason, kind === 'timeout' ? 'TimeoutError' : null);
    if (kind === 'timeout') assert.equal(evidence.termination.exitSignal, 'SIGTERM');
    else assert.equal(evidence.termination.exitSignal, null);
    if (kind === 'nonzero') assert.equal(evidence.exitCode, 7);
    if (kind === 'error') assert.equal(evidence.stderr, '[REDACTED]');
    assert.equal(bytes.includes(token), false);
    results.push({ kind, status: result.status, termination: evidence.termination });
  }
  console.log(
    JSON.stringify(
      { ok: true, evidenceKind: 'controlled-local-process-diagnostics-not-real-provider', results },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

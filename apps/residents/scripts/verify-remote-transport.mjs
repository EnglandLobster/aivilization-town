// Real TLS across isolated Docker network namespaces; no model or social-emergence claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  createIntegratedSocietyManifest,
  OpenSocietyRuntime,
  SocietyCommitReplica,
} from '@aivilization/worker';
import { loadResidentCredentials, PARTITION_SCHEDULER_VERSION } from '../dist/index.js';
const repo = resolve(import.meta.dirname, '../../..');
const root = resolve(
  process.argv[2] ?? join(repo, '.local/open-residents/remote-transport-acceptance'),
);
assert.equal(existsSync(root), false, 'use-fresh-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 90000, ...options }).trim();
const docker = (...args) => run('docker', args);
const network = `society-tls-${randomUUID()}`;
const authority = `${network}-authority`;
const image = 'node:24-bookworm-slim';
const manifest = createIntegratedSocietyManifest({ count: 1 });
const world = join(root, 'authority');
const runtime = new OpenSocietyRuntime(world, manifest);
const credentials = loadResidentCredentials(
  world,
  manifest.residents.map((r) => r.id),
);
runtime.close();
for (const dir of ['tls', 'compute', 'operator', 'replica', 'config'])
  mkdirSync(join(root, dir), { mode: 0o700 });
const token = randomBytes(32).toString('hex');
const save = (path, value) =>
  writeFileSync(join(root, path), JSON.stringify(value), { mode: 0o600 });
save('config/partitions.json', {
  version: PARTITION_SCHEDULER_VERSION,
  leaseMs: 60000,
  partitions: [{ id: 'p1', token, actors: [manifest.residents[0].id] }],
});
save('compute/credential.json', { token });
save('operator/credential.json', { token: credentials.admin });
run(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    join(root, 'tls/key.pem'),
    '-out',
    join(root, 'tls/cert.pem'),
    '-subj',
    '/CN=authority',
    '-addext',
    'subjectAltName=DNS:authority',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
const mount = (source, target, writable = false) => [
  '--mount',
  `type=bind,src=${source},dst=${target}${writable ? '' : ',readonly'}`,
];
const base = [
  '--network',
  network,
  '--user',
  `${process.getuid()}:${process.getgid()}`,
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--tmpfs',
  '/tmp:rw',
  '--workdir',
  '/workspace',
  ...['node_modules', 'packages', 'apps/worker', 'apps/residents', 'apps/api'].flatMap((p) =>
    mount(join(repo, p), `/workspace/${p}`),
  ),
];
let failure;
const report = { scope: 'single-host-isolated-container-network-namespaces', modelUsed: false };
try {
  report.image = docker('image', 'inspect', image, '--format', '{{.Id}}');
  docker('network', 'create', '--internal', network);
  docker(
    'run',
    '-d',
    '--name',
    authority,
    ...base,
    '--network-alias',
    'authority',
    '--network-alias',
    'wrong-authority',
    ...mount(world, '/world', true),
    ...mount(join(root, 'tls'), '/tls'),
    ...mount(join(root, 'config'), '/config'),
    image,
    'node',
    '/workspace/apps/residents/dist/cli.js',
    'serve',
    '--root',
    '/world',
    '--port',
    '4320',
    '--host',
    '0.0.0.0',
    '--advertise-host',
    'authority',
    '--tls-key',
    '/tls/key.pem',
    '--tls-cert',
    '/tls/cert.pem',
    '--partition-config',
    '/config/partitions.json',
  );
  for (let i = 0; i < 100; i++) {
    if (docker('logs', authority).includes('observer')) break;
    if (i === 99) throw Error('authority-start-timeout');
    await new Promise((r) => globalThis.setTimeout(r, 100));
  }
  report.authorityAddress = docker(
    'inspect',
    authority,
    '--format',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
  );
  const computeSource = `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { townRequest, runResidentPartitionOpportunity } from '/workspace/apps/residents/dist/index.js';
const endpoint='https://authority:4320', token=JSON.parse(readFileSync('/compute/credential.json')).token;
const connection={endpoint,token};
await assert.rejects(townRequest({endpoint:'http://authority:4320',token},'/partition/identity'), /insecure/);
await assert.rejects(townRequest({endpoint:'https://wrong-authority:4320',token},'/partition/identity'), e=>e.cause?.code==='ERR_TLS_CERT_ALTNAME_INVALID');
const noTrust=execFileSync(process.execPath,['--input-type=module','-e',"try { await fetch('https://authority:4320/partition/identity'); process.exit(2); } catch(e) { console.log(e.cause?.code); }"],{env:{},encoding:'utf8'}).trim();
assert.equal(noTrust,'DEPTH_ZERO_SELF_SIGNED_CERT');
let actions=0;
const result=await runResidentPartitionOpportunity({connection,directory:'/compute/session',claimId:'tls-claim',model:'engineering-test',createDriver:({connection:actor})=>({id:'compiled-shell',run:async()=>{
  const reply=JSON.parse(execFileSync(process.execPath,['/workspace/apps/residents/dist/residentShell.js','-c','town bank deposit --amount 7 --request-id tls-deposit'],{env:{TOWN_ENDPOINT:actor.endpoint,TOWN_RESIDENT_TOKEN:actor.token,NODE_EXTRA_CA_CERTS:'/tls/cert.pem'},encoding:'utf8'}));
  assert.equal(reply.ok,true); actions++;
  assert.equal((await fetch(endpoint+'/admin/replication/manifest',{headers:{authorization:'Bearer '+actor.token}})).status,403);
  assert.equal((await fetch(endpoint+'/context',{headers:{authorization:'Bearer '+token}})).status,404);
  return {status:'completed',summary:'TLS transport engineering validation'};
}})});
assert.equal(result.status,'completed'); assert.equal(actions,1);
console.log(JSON.stringify({status:result.status,compiledShell:true,wrongHostnameRejected:true,untrustedCaRejected:true,remoteHttpRejected:true,actorAdminRejected:true,partitionActorRejected:true}));
`;
  report.compute = JSON.parse(
    docker(
      'run',
      '--rm',
      '-i',
      ...base,
      ...mount(join(root, 'compute'), '/compute', true),
      ...mount(join(root, 'tls/cert.pem'), '/tls/cert.pem'),
      '-e',
      'NODE_EXTRA_CA_CERTS=/tls/cert.pem',
      image,
      'node',
      '--input-type=module',
      '-e',
      computeSource,
    ),
  );
  const replicaSource = `
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {syncSocietyReplica} from '/workspace/apps/residents/dist/index.js';
const token=JSON.parse(readFileSync('/operator/credential.json')).token;
const result=await syncSocietyReplica({root:'/replica',endpoint:'https://authority:4320',token});
assert.equal(result.status,'caught-up'); console.log(JSON.stringify(result));`;
  report.replication = JSON.parse(
    docker(
      'run',
      '--rm',
      ...base,
      ...mount(join(root, 'operator'), '/operator'),
      ...mount(join(root, 'replica'), '/replica', true),
      ...mount(join(root, 'tls/cert.pem'), '/tls/cert.pem'),
      '-e',
      'NODE_EXTRA_CA_CERTS=/tls/cert.pem',
      image,
      'node',
      '--input-type=module',
      '-e',
      replicaSource,
    ),
  );
  docker('stop', '--time', '10', authority);
  const reopened = new OpenSocietyRuntime(world);
  const replica = new SocietyCommitReplica(join(root, 'replica'));
  try {
    assert.deepEqual(replica.state, reopened.state);
    assert.equal(reopened.state.world.bank.balance, manifest.initialWorld.bank.balance + 7);
    assert.equal(reopened.state.world.moneySupply, manifest.initialWorld.moneySupply);
    report.fullReplayEqual = true;
    report.singleDeposit = 7;
    report.moneySupplyConserved = true;
  } finally {
    replica.close();
    reopened.close();
  }
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = String(error);
} finally {
  try {
    docker('rm', '-f', authority);
  } catch {
    /* absent after startup failure */
  }
  try {
    docker('network', 'rm', network);
  } catch {
    /* absent after startup failure */
  }
  save('verification.json', report);
}
console.log(JSON.stringify(report, null, 2));
if (failure) throw failure;

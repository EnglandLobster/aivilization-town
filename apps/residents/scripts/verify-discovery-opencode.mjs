// Prompted usability acceptance, not spontaneous organization or a model-quality benchmark.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  createOpenCodeResidentDriver,
  loadResidentCredentials,
  startResidentServer,
} from '../dist/index.js';

const root = resolve(process.argv[2] ?? '.local/open-residents/discovery-acceptance');
if (existsSync(join(root, 'manifest.json'))) throw new Error('use-a-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 2 }));
const [a, b] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b]);
const server = await startResidentServer(runtime, credentials);
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
const initialWorld = structuredClone(runtime.state.world);
const turns = [];
let failure;
try {
  const tasks = [
    `你希望和${b}共同记下各自的活动想法。请自行查找平台帮助，建立ID为discovery-notes的私有共享结构化记录簿，唯一字段note为字符串；让对方也有读取与写入权限。你只写一条自己创作的想法，不代替对方写。不要转账、移动、推进时间或运行程序。`,
    '另一位居民建立了discovery-notes共享记录簿。请自行查找帮助，读取其中已有原话，再独立追加一条你自己的想法。不修改对方原话，也不把双方想法当成已经达成的承诺。不要转账、移动、推进时间或运行程序。',
  ];
  for (let i = 0; i < tasks.length; i++) {
    const actorId = i === 0 ? a : b;
    const turn = runtime.beginTurn(actorId, 'discovery-prompted-usability');
    const directory = join(root, 'opencode', actorId);
    console.log(JSON.stringify({ stage: i + 1, actorId, status: 'running' }));
    const driver = createOpenCodeResidentDriver({
      connection: { endpoint: server.url, token: credentials.residents[actorId] },
      model,
      directory,
      task: `这是明确提示的可用性验收，不是自由社会实验。先用town find检索相关能力，按返回帮助自主选择原操作完成目标；没有给你领域命令或参数模板。\n${tasks[i]}\n完成后结束本轮，不安排等待。`,
    });
    const result = await driver.run({
      actorId,
      turnId: turn.id,
      context: runtime.context(actorId),
      signal: globalThis.AbortSignal.timeout(300000),
      invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
    });
    runtime.finishTurn(actorId, result);
    const evidence = JSON.parse(readFileSync(join(directory, `${turn.id}.json`), 'utf8'));
    const commands = evidence.events.flatMap((event) => {
      if (event.type !== 'tool_use') return [];
      const command = event.part?.state?.input?.command;
      return typeof command === 'string' ? [command] : [];
    });
    const discoveries = evidence.events
      .filter((e) => e.type === 'tool_use')
      .flatMap((event) => {
        const command = event.part?.state?.input?.command;
        if (typeof command !== 'string' || !/^town find\s/.test(command)) return [];
        let result;
        try {
          result = JSON.parse(event.part.state.output);
        } catch {
          result = null;
        }
        const laterCommands = commands.slice(commands.indexOf(command) + 1);
        return [
          {
            command,
            total: result?.total ?? null,
            matching: result?.matching ?? null,
            followedResult:
              Array.isArray(result?.items) &&
              result.items.some((item) => laterCommands.includes(item.helpWith)),
          },
        ];
      });
    turns.push({
      actorId,
      status: result.status,
      calls: runtime.state.turns[turn.id].calls,
      commands,
      discoveries,
    });
    console.log(JSON.stringify({ stage: i + 1, status: result.status, calls: turns.at(-1).calls }));
    if (result.status !== 'completed') throw new Error('provider-error');
  }
} catch (error) {
  failure = error instanceof Error ? error.message : 'unknown-error';
}
const s = runtime.state;
const register = s.sharedRecords?.registers['discovery-notes'];
const records = Object.values(s.sharedRecords?.records ?? {}).filter(
  (r) => r.registerId === 'discovery-notes',
);
const checks = {
  bothUsedDiscovery:
    turns.length === 2 && turns.every((t) => t.commands.some((c) => /^town find\s/.test(c))),
  bothFollowedSearchResult:
    turns.length === 2 &&
    turns.every((t) => t.discoveries.some((d) => d.total > 0 && d.followedResult)),
  privateSharedRegister: register?.visibility === 'private' && register.editors.includes(b),
  independentOriginals:
    records.length === 2 &&
    [a, b].every((id) =>
      records.some(
        (r) => r.editedBy === id && r.authorityId === id && typeof r.values.note === 'string',
      ),
    ),
  worldUnchanged: JSON.stringify(s.world) === JSON.stringify(initialWorld),
};
const state = structuredClone(s);
const bytes = readFileSync(join(root, 'journal.jsonl'));
await server.close();
runtime.close();
const reopened = new OpenSocietyRuntime(root);
let replayEqual = false;
try {
  assert.deepEqual(reopened.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  replayEqual = true;
} finally {
  reopened.close();
}
const result = {
  mode: 'prompted-discovery-usability-not-emergence',
  model,
  passed: !failure && replayEqual && Object.values(checks).every(Boolean),
  turns,
  checks,
  replayEqual,
  ...(failure ? { failure } : {}),
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;

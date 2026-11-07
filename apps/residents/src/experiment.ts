import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import {
  OPEN_CAPABILITY_CATALOG_VERSION,
  RESIDENT_SKILL_VERSION,
  isTownProfile,
  type OpenSocietyManifest,
} from '@aivilization/worker';

/**
 * A free-run experiment: arms (towns) that run in parallel with the same model and settings until
 * each reaches a target number of acted opportunities. Settings that change what is being
 * compared are pinned into each town on the first run; only the target and the outage limit may
 * change later (to extend a run). Every start records which engine build ran.
 */
export const EXPERIMENT_VERSION = 'open-society-experiment-v1';
export type ExperimentArm = {
  readonly name: string;
  readonly root: string;
  readonly profile: string;
  readonly count: number;
  readonly initialization: 'settled' | 'newcomers';
};
export type ExperimentDefinition = {
  readonly version: typeof EXPERIMENT_VERSION;
  readonly name: string;
  readonly model: string;
  readonly opencode?: string;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly targetOpportunities: number;
  readonly maxOutageMinutes: number;
  readonly arms: readonly ExperimentArm[];
};

function fail(field: string): never {
  throw new Error(`invalid-experiment:${field}`);
}
function int(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(field);
  return value as number;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) fail(field);
  return value;
}
export function parseExperiment(value: unknown): ExperimentDefinition {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('object');
  const v = value as Record<string, unknown>;
  const known = [
    'version',
    'name',
    'model',
    'opencode',
    'timeoutMs',
    'concurrency',
    'targetOpportunities',
    'maxOutageMinutes',
    'arms',
  ];
  for (const key of Object.keys(v)) if (!known.includes(key)) fail(key);
  if (v.version !== EXPERIMENT_VERSION) fail('version');
  if (!Array.isArray(v.arms) || v.arms.length < 1 || v.arms.length > 8) fail('arms');
  const arms = v.arms.map((arm: unknown, i): ExperimentArm => {
    if (arm === null || typeof arm !== 'object') fail(`arms[${i}]`);
    const a = arm as Record<string, unknown>;
    for (const key of Object.keys(a))
      if (!['name', 'root', 'profile', 'count', 'initialization'].includes(key))
        fail(`arms[${i}].${key}`);
    if (!isTownProfile(a.profile)) fail(`arms[${i}].profile`);
    if (a.initialization !== 'settled' && a.initialization !== 'newcomers')
      fail(`arms[${i}].initialization`);
    return {
      name: text(a.name, `arms[${i}].name`),
      root: text(a.root, `arms[${i}].root`),
      profile: a.profile,
      count: int(a.count, `arms[${i}].count`, 1, 50),
      initialization: a.initialization,
    };
  });
  if (new Set(arms.map((a) => resolve(a.root))).size !== arms.length) fail('arms.root-duplicate');
  if (new Set(arms.map((a) => a.name)).size !== arms.length) fail('arms.name-duplicate');
  return {
    version: EXPERIMENT_VERSION,
    name: text(v.name, 'name'),
    model: text(v.model, 'model'),
    ...(v.opencode === undefined ? {} : { opencode: text(v.opencode, 'opencode') }),
    timeoutMs: int(v.timeoutMs, 'timeoutMs', 1000, 600_000),
    concurrency: int(v.concurrency, 'concurrency', 1, 32),
    targetOpportunities: int(v.targetOpportunities, 'targetOpportunities', 1, 1_000_000),
    maxOutageMinutes: int(v.maxOutageMinutes, 'maxOutageMinutes', 0, 10_080),
    arms,
  };
}

/** What may not change once an arm has run: everything except the target and outage limit. */
function pinned(definition: ExperimentDefinition, arm: ExperimentArm) {
  return {
    version: definition.version,
    name: definition.name,
    model: definition.model,
    opencode: definition.opencode ?? null,
    timeoutMs: definition.timeoutMs,
    concurrency: definition.concurrency,
    arm,
  };
}
/** JSON with sorted keys, so the pin does not depend on property order. */
function sortedJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v: unknown) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : v,
    2,
  );
}
function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Prepare every arm (init, check, pin) before any of them starts running. */
export function prepareExperiment(definition: ExperimentDefinition, cli: string) {
  const require = createRequire(import.meta.url);
  const engine = {
    catalog: OPEN_CAPABILITY_CATALOG_VERSION,
    skill: RESIDENT_SKILL_VERSION,
    residentsCli: fileDigest(cli),
    worker: fileDigest(require.resolve('@aivilization/worker')),
  };
  return definition.arms.map((arm) => {
    const root = resolve(arm.root);
    if (!existsSync(join(root, 'manifest.json'))) {
      const init = spawnSync(
        process.execPath,
        [
          cli,
          'init',
          '--root',
          root,
          '--count',
          String(arm.count),
          '--initialization',
          arm.initialization,
          '--profile',
          arm.profile,
        ],
        { encoding: 'utf8' },
      );
      if (init.status !== 0)
        throw new Error(`experiment-arm-init-failed:${arm.name}:${init.stderr}`);
    }
    const manifest = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8'),
    ) as OpenSocietyManifest;
    if (
      manifest.provenance.runProfile !== arm.profile ||
      manifest.residents.length !== arm.count ||
      manifest.initialization !== arm.initialization
    )
      throw new Error(`experiment-arm-town-mismatch:${arm.name}`);
    const pinPath = join(root, 'experiment.json');
    const pin = `${sortedJson(pinned(definition, arm))}\n`;
    if (!existsSync(pinPath)) writeFileSync(pinPath, pin, { flag: 'wx', mode: 0o600 });
    else if (readFileSync(pinPath, 'utf8') !== pin)
      throw new Error(`experiment-arm-settings-changed:${arm.name}`);
    return { arm, root, engine };
  });
}

/** Run every prepared arm in parallel to the target; resolves with each arm's exit code. */
export async function runExperiment(
  definition: ExperimentDefinition,
  cli: string,
  onLine: (line: unknown) => void,
): Promise<{ readonly arm: string; readonly exitCode: number | null }[]> {
  const arms = prepareExperiment(definition, cli);
  return Promise.all(
    arms.map(
      ({ arm, root, engine }) =>
        new Promise<{ readonly arm: string; readonly exitCode: number | null }>((done) => {
          appendFileSync(
            join(root, 'experiment-runs.jsonl'),
            `${JSON.stringify({
              startedAt: new Date().toISOString(),
              experiment: definition.name,
              targetOpportunities: definition.targetOpportunities,
              maxOutageMinutes: definition.maxOutageMinutes,
              engine,
            })}\n`,
            { mode: 0o600 },
          );
          const log = openSync(join(root, 'run.log'), 'a', 0o600);
          const child = spawn(
            process.execPath,
            [
              cli,
              'run',
              '--root',
              root,
              '--mode',
              'free',
              '--model',
              definition.model,
              '--target-opportunities',
              String(definition.targetOpportunities),
              '--concurrency',
              String(definition.concurrency),
              '--timeout',
              String(definition.timeoutMs),
              '--max-outage-minutes',
              String(definition.maxOutageMinutes),
              ...(definition.opencode === undefined ? [] : ['--opencode', definition.opencode]),
            ],
            { stdio: ['ignore', log, log] },
          );
          onLine({ arm: arm.name, root, status: 'started', pid: child.pid });
          child.on('exit', (exitCode) => {
            closeSync(log);
            onLine({ arm: arm.name, status: 'finished', exitCode });
            done({ arm: arm.name, exitCode });
          });
        }),
    ),
  );
}

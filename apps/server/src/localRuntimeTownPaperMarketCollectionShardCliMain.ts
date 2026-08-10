import {
  FilePaperMarketCollectionLedger,
  createEpochIdempotencyKey,
} from '@aivilization/worker';
import { resolveLocalRuntimeTownCliConfig } from './localRuntimeTownCli';
import { runLocalRuntimeTownPaperMarketCollectionShardEpoch } from './localRuntimeTownPaperMarketCollectionShard';

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const ledger = new FilePaperMarketCollectionLedger(options.collectionRootDir);
  const plan = ledger.loadPlan(options.collectionId);
  if (plan === undefined) {
    throw new Error(`paper market collection ${options.collectionId} does not exist`);
  }
  const shard = plan.shards.find((candidate) => candidate.shardId === options.shardId);
  if (shard === undefined) throw new Error(`paper market collection shard ${options.shardId} is unknown`);
  const expectedIdempotencyKey = createEpochIdempotencyKey(
    plan.collectionId,
    shard.shardId,
    options.epochIndex,
  );
  if (options.idempotencyKey !== expectedIdempotencyKey) {
    throw new Error('paper market collection shard idempotency key is invalid');
  }
  const projection = ledger.project(plan.collectionId, Date.now());
  const previousResult =
    options.epochIndex === 0
      ? undefined
      : projection.epochs.find(
          (epoch) =>
            epoch.shardId === shard.shardId && epoch.epochIndex === options.epochIndex - 1,
        )?.result;
  if (options.epochIndex > 0 && previousResult === undefined) {
    throw new Error('paper market collection previous shard epoch is incomplete');
  }
  const runtimeConfig = resolveLocalRuntimeTownCliConfig({
    argv: [
      '--profile',
      plan.profileId,
      '--root-dir',
      shard.runtimeRootDir,
      '--port',
      '0',
      '--seed',
      shard.seed,
      '--llm-mode',
      'deterministic',
    ],
    sourceRevision: plan.sourceRevision,
  });
  const result = await runLocalRuntimeTownPaperMarketCollectionShardEpoch({
    plan,
    shard,
    epochIndex: options.epochIndex,
    idempotencyKey: options.idempotencyKey,
    runtimeConfig,
    ...(previousResult === undefined ? {} : { previousResult }),
  });
  console.log(JSON.stringify({ event: 'paper-market-collection-shard-completed', result }));
}

function parseOptions(argv: readonly string[]): {
  readonly collectionRootDir: string;
  readonly collectionId: string;
  readonly shardId: string;
  readonly epochIndex: number;
  readonly idempotencyKey: string;
} {
  const values = new Map<string, string>();
  const names = new Set([
    '--collection-root-dir',
    '--collection-id',
    '--shard-id',
    '--epoch-index',
    '--idempotency-key',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (!names.has(name)) throw new Error(`unknown paper market collection shard option ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (values.has(name)) throw new Error(`${name} must not be repeated`);
    values.set(name, value);
    index += 1;
  }
  const epochIndex = Number(requireValue(values, '--epoch-index'));
  if (!Number.isSafeInteger(epochIndex) || epochIndex < 0) {
    throw new Error('--epoch-index must be a non-negative integer');
  }
  return {
    collectionRootDir: requireValue(values, '--collection-root-dir'),
    collectionId: requireValue(values, '--collection-id'),
    shardId: requireValue(values, '--shard-id'),
    epochIndex,
    idempotencyKey: requireValue(values, '--idempotency-key'),
  };
}

function requireValue(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});

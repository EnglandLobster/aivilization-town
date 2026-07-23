import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  PaperMarketCollectionEpochResult,
  PaperMarketCollectionRunner,
} from '@aivilization/worker';

const MAX_CHILD_OUTPUT_BYTES = 1_048_576;

export type PaperMarketCollectionProcessObserver = {
  readonly onChildStarted?: (input: {
    readonly executionId: string;
    readonly shardId: string;
    readonly epochIndex: number;
    readonly pid: number;
  }) => void;
  readonly onChildCompleted?: (input: {
    readonly executionId: string;
    readonly shardId: string;
    readonly epochIndex: number;
    readonly pid: number;
    readonly result: PaperMarketCollectionEpochResult;
  }) => void;
  readonly onChildFailed?: (input: {
    readonly executionId: string;
    readonly shardId: string;
    readonly epochIndex: number;
    readonly pid: number;
    readonly error: Error;
  }) => void;
};

export function createLocalRuntimeTownPaperMarketCollectionProcessRunner(input: {
  readonly collectionRootDir: string;
  readonly executablePath?: string;
  readonly shardEntryPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly observer?: PaperMarketCollectionProcessObserver;
}): PaperMarketCollectionRunner {
  const executablePath = input.executablePath ?? process.execPath;
  const shardEntryPath =
    input.shardEntryPath ??
    fileURLToPath(
      new URL('./localRuntimeTownPaperMarketCollectionShardCliMain.js', import.meta.url),
    );
  return (request) =>
    runShardProcess({
      executablePath,
      shardEntryPath,
      collectionRootDir: input.collectionRootDir,
      collectionId: request.plan.collectionId,
      shardId: request.shard.shardId,
      epochIndex: request.epochIndex,
      idempotencyKey: request.idempotencyKey,
      timeoutMs: request.plan.leaseDurationMs,
      environment: input.environment ?? process.env,
      ...(input.observer === undefined ? {} : { observer: input.observer }),
    });
}

export async function runShardProcess(input: {
  readonly executablePath: string;
  readonly shardEntryPath: string;
  readonly collectionRootDir: string;
  readonly collectionId: string;
  readonly shardId: string;
  readonly epochIndex: number;
  readonly idempotencyKey: string;
  readonly timeoutMs: number;
  readonly environment: NodeJS.ProcessEnv;
  readonly observer?: PaperMarketCollectionProcessObserver;
}): Promise<PaperMarketCollectionEpochResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      input.executablePath,
      [
        '--enable-source-maps',
        input.shardEntryPath,
        '--collection-root-dir',
        input.collectionRootDir,
        '--collection-id',
        input.collectionId,
        '--shard-id',
        input.shardId,
        '--epoch-index',
        String(input.epochIndex),
        '--idempotency-key',
        input.idempotencyKey,
      ],
      { env: input.environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const pid = child.pid;
    if (pid === undefined) {
      child.kill('SIGKILL');
      rejectResult(new Error('paper market collection child process has no pid'));
      return;
    }
    const executionId = `${input.shardId}:${input.epochIndex}:${pid}`;
    input.observer?.onChildStarted?.({
      executionId,
      shardId: input.shardId,
      epochIndex: input.epochIndex,
      pid,
    });
    const notifyFailed = (error: unknown): Error => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      input.observer?.onChildFailed?.({
        executionId,
        shardId: input.shardId,
        epochIndex: input.epochIndex,
        pid,
        error: normalized,
      });
      return normalized;
    };
    const finish = (
      handler: () => PaperMarketCollectionEpochResult,
      rejectOnError: (error: unknown) => void,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        resolveResult(handler());
      } catch (error) {
        rejectOnError(error);
      }
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      // A graceful shutdown terminalizes the durable run session as a
      // partition failure. Hard termination intentionally leaves the session
      // non-terminal so the next lease owner can recover the same operation.
      child.kill('SIGKILL');
      settled = true;
      rejectResult(
        notifyFailed(
          new Error(
            `paper market collection shard ${input.shardId}:${input.epochIndex} exceeded lease timeout ${input.timeoutMs}ms`,
          ),
        ),
      );
    }, input.timeoutMs);
    const capture = (streamName: 'stdout' | 'stderr', chunk: Buffer) => {
      if (settled) return;
      try {
        if (streamName === 'stdout') stdout = appendBounded(stdout, chunk, streamName);
        else stderr = appendBounded(stderr, chunk, streamName);
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        rejectResult(notifyFailed(error));
      }
    };
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectResult(notifyFailed(error));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        settled = true;
        clearTimeout(timeout);
        rejectResult(
          notifyFailed(
            new Error(
              `paper market collection shard ${input.shardId}:${input.epochIndex} exited code=${String(code)} signal=${String(signal)}: ${stderr.trim()}`,
            ),
          ),
        );
        return;
      }
      finish(() => {
        try {
          const result = parseShardResult(stdout);
          input.observer?.onChildCompleted?.({
            executionId,
            shardId: input.shardId,
            epochIndex: input.epochIndex,
            pid,
            result,
          });
          return result;
        } catch (error) {
          throw notifyFailed(error);
        }
      }, rejectResult);
    });
  });
}

function appendBounded(current: string, chunk: Buffer, streamName: string): string {
  const next = current + chunk.toString('utf8');
  if (Buffer.byteLength(next, 'utf8') > MAX_CHILD_OUTPUT_BYTES) {
    throw new Error(`paper market collection child ${streamName} exceeded output limit`);
  }
  return next;
}

function parseShardResult(stdout: string): PaperMarketCollectionEpochResult {
  for (const line of stdout.trim().split('\n').reverse()) {
    if (line.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).event === 'paper-market-collection-shard-completed'
    ) {
      return (value as { readonly result: PaperMarketCollectionEpochResult }).result;
    }
  }
  throw new Error('paper market collection shard did not emit a completion result');
}

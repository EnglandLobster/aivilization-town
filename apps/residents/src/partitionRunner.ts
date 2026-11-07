import {
  bindPartitionComputeDirectory,
  readPartitionResult,
  writePartitionResult,
  observedPartitionSession,
} from './partitionCheckpoint';
import { join } from 'node:path';
import type { OpenAgentDriver, OpenToolResult } from '@aivilization/agent-runtime';
import type { ResidentPartitionExecution } from './partitionExecution';
import { townRequest, type TownConnection } from './townConnection';
import { createOpenCodeResidentDriver } from './openCode';
/** One remote compute opportunity. Only a short-lived actor token reaches the resident driver. */
export async function runResidentPartitionOpportunity(input: {
  readonly connection: TownConnection;
  readonly directory: string;
  readonly claimId: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly createDriver?: (input: {
    actorId: string;
    connection: TownConnection;
    directory: string;
    sessionId?: string;
  }) => OpenAgentDriver;
}) {
  input.signal?.throwIfAborted();
  const timeout = input.timeoutMs ?? 180000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600000)
    throw Error('invalid-partition-timeout');
  const identity = (await townRequest(input.connection, '/partition/identity')) as ReturnType<
    ResidentPartitionExecution['identity']
  >;
  bindPartitionComputeDirectory(input.directory, identity.authorityId, identity.partitionId);
  // Authenticated authority response. No replica projection or resident-supplied actor is trusted here.
  const claim = (await townRequest(input.connection, '/partition/claim', {
    claimId: input.claimId,
    authorityId: identity.authorityId,
  })) as ReturnType<ResidentPartitionExecution['claim']>;
  if (claim.status === 'waiting') return claim;
  bindPartitionComputeDirectory(input.directory, claim.authorityId, claim.partitionId);
  const directory = join(input.directory, claim.actorId);
  const checkpoint = readPartitionResult(directory, claim.actorId, claim.turnId, claim.authorityId);
  const observed = observedPartitionSession(
    directory,
    claim.actorId,
    claim.turnId,
    claim.authorityId,
  );
  const sessionId = observed ?? claim.sessionId;
  const connection = { endpoint: input.connection.endpoint, token: claim.token };
  let result: Awaited<ReturnType<OpenAgentDriver['run']>>;
  if (checkpoint) {
    result = checkpoint;
  } else if (claim.turn.status === 'waiting' || claim.turn.status === 'budget-exhausted') {
    result = {
      status: 'completed',
      summary: claim.turn.summary,
      ...(sessionId ? { sessionId } : {}),
    };
  } else {
    const driverInput = {
      actorId: claim.actorId,
      sessionScope: claim.authorityId,
      connection,
      directory,
      ...(sessionId ? { sessionId } : {}),
    };
    try {
      const driver =
        input.createDriver?.(driverInput) ??
        createOpenCodeResidentDriver({ ...driverInput, model: input.model });
      const signals = [
        AbortSignal.timeout(Math.min(timeout, Math.max(1, claim.remainingLeaseMs - 250))),
        ...(input.signal ? [input.signal] : []),
      ];
      result = await driver.run({
        actorId: claim.actorId,
        turnId: claim.turnId,
        context: claim.context,
        signal: AbortSignal.any(signals),
        invoke: async (request) =>
          (await townRequest(connection, '/invoke', request)) as OpenToolResult,
      });
    } catch (error) {
      const observedSession = observedPartitionSession(
        directory,
        claim.actorId,
        claim.turnId,
        claim.authorityId,
      );
      result = {
        ...(observedSession ? { sessionId: observedSession } : {}),
        status: 'provider-error',
        summary: error instanceof Error ? error.message : 'partition-driver-failed',
      };
    }
  }
  writePartitionResult(directory, claim.actorId, claim.turnId, result, claim.authorityId);
  const finished = await townRequest(input.connection, '/partition/finish', {
    token: claim.token,
    status: result.status,
    summary: result.summary,
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
  });
  return { status: result.status, actorId: claim.actorId, turnId: claim.turnId, finished };
}

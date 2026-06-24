import type {
  CommandRecord,
  CommandStore,
  CommandStreamName,
  CommandStreamReadOptions,
} from '@aivilization/sim-core';
import type { WorkerSteeringCommand } from './steering';

export type WorkerCommandStreamHandler<TResult> = (input: {
  readonly record: CommandRecord<WorkerSteeringCommand>;
  readonly command: WorkerSteeringCommand;
}) => TResult | Promise<TResult>;

export type WorkerCommandStreamConsumptionResult<TResult> =
  | {
      readonly status: 'drained';
      readonly handledRecords: readonly CommandRecord<WorkerSteeringCommand>[];
      readonly results: readonly TResult[];
      readonly lastConsumedSequence: number;
      readonly streamVersion: number;
    }
  | {
      readonly status: 'failed';
      readonly handledRecords: readonly CommandRecord<WorkerSteeringCommand>[];
      readonly results: readonly TResult[];
      readonly lastConsumedSequence: number;
      readonly streamVersion: number;
      readonly failedRecord: CommandRecord<WorkerSteeringCommand>;
      readonly error: unknown;
    };

export async function consumeWorkerCommandStream<TResult>(input: {
  readonly commandStore: CommandStore<WorkerSteeringCommand>;
  readonly streamName: CommandStreamName;
  readonly afterSequence: number;
  readonly limit?: number;
  readonly handle: WorkerCommandStreamHandler<TResult>;
}): Promise<WorkerCommandStreamConsumptionResult<TResult>> {
  const streamVersion = input.commandStore.getStreamVersion(input.streamName);
  const records = input.commandStore.readStream(input.streamName, createReadOptions(input));
  const handledRecords: CommandRecord<WorkerSteeringCommand>[] = [];
  const results: TResult[] = [];
  let lastConsumedSequence = input.afterSequence;

  for (const record of records) {
    try {
      const result = await input.handle({ record, command: record.command });
      handledRecords.push(record);
      results.push(result);
      lastConsumedSequence = record.sequence;
    } catch (error) {
      return {
        status: 'failed',
        handledRecords,
        results,
        lastConsumedSequence,
        streamVersion,
        failedRecord: record,
        error,
      };
    }
  }

  return {
    status: 'drained',
    handledRecords,
    results,
    lastConsumedSequence,
    streamVersion,
  };
}

function createReadOptions(input: {
  readonly afterSequence: number;
  readonly limit?: number;
}): CommandStreamReadOptions {
  return {
    afterSequence: input.afterSequence,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

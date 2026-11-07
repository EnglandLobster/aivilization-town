import { randomUUID } from 'node:crypto';
import { runResidentPartitionOpportunity } from './partitionRunner';
type OpportunityInput = Parameters<typeof runResidentPartitionOpportunity>[0];
/** Persistent compute loop, never an alternative world scheduler or automatic model retry. */
export async function runResidentPartitionWorker(
  input: Omit<OpportunityInput, 'claimId'> & {
    readonly maxOpportunities?: number;
    readonly pollMs?: number;
    readonly onProgress?: (value: {
      status: string;
      opportunities: number;
      completed: number;
    }) => void;
  },
) {
  const poll = input.pollMs ?? 1000;
  if (
    !Number.isSafeInteger(poll) ||
    poll < 100 ||
    poll > 60000 ||
    (input.maxOpportunities !== undefined &&
      (!Number.isSafeInteger(input.maxOpportunities) || input.maxOpportunities < 1))
  )
    throw Error('invalid-partition-worker-budget');
  let opportunities = 0,
    completed = 0,
    claimId = randomUUID();
  while (
    !input.signal?.aborted &&
    (input.maxOpportunities === undefined || opportunities < input.maxOpportunities)
  ) {
    let result: Awaited<ReturnType<typeof runResidentPartitionOpportunity>>;
    try {
      result = await runResidentPartitionOpportunity({ ...input, claimId });
    } catch (error) {
      if (input.signal?.aborted) break;
      throw error;
    }
    if (result.status === 'waiting') {
      await new Promise<void>((resolve) => {
        const stop = () => {
          clearTimeout(timer);
          input.signal?.removeEventListener('abort', stop);
          resolve();
        };
        const timer = setTimeout(stop, poll);
        input.signal?.addEventListener('abort', stop, { once: true });
        if (input.signal?.aborted) stop();
      });
      continue;
    }
    opportunities++;
    if (result.status === 'completed') completed++;
    input.onProgress?.({ status: result.status, opportunities, completed });
    if (input.signal?.aborted) break;
    if (result.status === 'provider-error')
      return { status: 'provider-error' as const, opportunities, completed };
    claimId = randomUUID();
  }
  return {
    status: input.signal?.aborted ? ('stopped' as const) : ('limit-reached' as const),
    opportunities,
    completed,
  };
}

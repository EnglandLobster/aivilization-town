export const PROGRAM_REACTIONS_POLICY = {
  version: 'resident-program-reactions-v1',
  maxWatchesPerRunner: 20,
  maxWatches: 1000,
  maxReactions: 100,
  maxHorizonMs: 30 * 86400000,
  maxPending: 128,
  maxPerDrain: 32,
} as const;
export type ProgramReactionsPolicy = { readonly version: 'resident-program-reactions-v1' } & {
  readonly [K in Exclude<keyof typeof PROGRAM_REACTIONS_POLICY, 'version'>]: number;
};
export type ProgramWatch = {
  readonly id: string;
  readonly runnerId: string;
  readonly programId: string;
  readonly programRevision: number;
  readonly participants: readonly string[];
  readonly maxReactions: number;
  readonly expiresAt: number;
  readonly enqueued: number;
  readonly completed: number;
  readonly succeeded: number;
  readonly sourceToken: string;
  readonly revision: number;
  readonly status: 'active' | 'completed' | 'cancelled' | 'failed' | 'expired';
  readonly at: number;
  readonly reason?: string;
  readonly stoppedAtSequence?: number;
};
export type ProgramReaction = {
  readonly id: string;
  readonly watchId: string;
  readonly sourceSequence: number;
  readonly enqueuedAt: number;
  readonly status: 'pending' | 'succeeded' | 'skipped' | 'failed' | 'cancelled';
  readonly revision: number;
  readonly at: number;
  readonly reason?: string;
  readonly runId?: string;
};
export type ProgramReactionsState = {
  readonly policy: ProgramReactionsPolicy;
  readonly watches: Readonly<Record<string, ProgramWatch>>;
  readonly reactions: Readonly<Record<string, ProgramReaction>>;
};
export type ProgramReactionEvent =
  | { readonly type: 'ProgramReactionsEnabled'; readonly policy: ProgramReactionsPolicy }
  | { readonly type: 'ProgramWatchChanged'; readonly watch: ProgramWatch }
  | { readonly type: 'ProgramReactionChanged'; readonly reaction: ProgramReaction };
export function assertProgramReactionsPolicy(p: ProgramReactionsPolicy) {
  if (
    p.version !== PROGRAM_REACTIONS_POLICY.version ||
    Object.keys(PROGRAM_REACTIONS_POLICY).some(
      (k) =>
        k !== 'version' &&
        (!Number.isSafeInteger(p[k as keyof ProgramReactionsPolicy]) ||
          Number(p[k as keyof ProgramReactionsPolicy]) < 1),
    )
  )
    throw new Error('invalid-program-reactions-policy');
}
export function emptyProgramReactions(
  policy: ProgramReactionsPolicy = PROGRAM_REACTIONS_POLICY,
): ProgramReactionsState {
  assertProgramReactionsPolicy(policy);
  return { policy, watches: {}, reactions: {} };
}

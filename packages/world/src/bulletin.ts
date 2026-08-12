import type { AgentId } from '@aivilization/sim-core';

export const TOWN_BULLETIN_POLICY_VERSION = 'town-bulletin-v1';

export type TownBulletinPriority = 'normal' | 'high';

/**
 * Versioned town-bulletin policy. Settlement is event-sourced (BulletinScheduled /
 * BulletinPosted); the policy only versions the rules and tunes the
 * high-priority preemption reaction. Opt-in via the town-bulletin switch:
 * without the policy the post/issue commands are rejected and no bulletin
 * state or events exist.
 */
export type TownBulletinPolicy = {
  readonly policyVersion: string;
  /** ScheduledIntention priority used for high-priority bulletin preemption. */
  readonly highPriorityIntentionPriority: number;
  /** Reaction window (wall ms) for the high-priority bulletin intention. */
  readonly highPriorityReactionWindowMs: number;
};

/**
 * A town bulletin as carried by BulletinScheduled/BulletinPosted events.
 * `postedAt` is the command issue time; `effectiveAt` is the simulation time
 * from which residents become aware of the bulletin. Exactly one author field
 * is present: agent posts carry `authorAgentId`, operator-issued town
 * bulletins carry `authorSubjectId` (the human principal).
 */
export type TownBulletin = {
  readonly bulletinId: string;
  readonly title: string;
  readonly body: string;
  readonly priority: TownBulletinPriority;
  readonly authorAgentId?: AgentId;
  readonly authorSubjectId?: string;
  readonly postedAt: number;
  readonly effectiveAt: number;
};

export type WorldBulletinState = TownBulletin & {
  readonly status: 'scheduled' | 'effective';
};

export function createTownBulletin(input: {
  readonly bulletinId: string;
  readonly title: string;
  readonly body: string;
  readonly priority?: TownBulletinPriority;
  readonly authorAgentId?: AgentId;
  readonly authorSubjectId?: string;
  readonly postedAt: number;
  readonly effectiveAt?: number;
  readonly currentSimulationTime: number;
}): TownBulletin {
  if (input.bulletinId.trim().length === 0) {
    throw new Error('bulletinId must not be empty');
  }
  if (input.title.trim().length === 0) {
    throw new Error('bulletin title must not be empty');
  }
  if (input.body.trim().length === 0) {
    throw new Error('bulletin body must not be empty');
  }
  if (
    input.priority !== undefined &&
    input.priority !== 'normal' &&
    input.priority !== 'high'
  ) {
    throw new Error('bulletin priority must be normal or high');
  }
  if ((input.authorAgentId === undefined) === (input.authorSubjectId === undefined)) {
    throw new Error('bulletin requires exactly one author (agent or human subject)');
  }
  if (!Number.isFinite(input.postedAt)) {
    throw new Error('bulletin postedAt must be finite');
  }
  const effectiveAt = input.effectiveAt ?? input.currentSimulationTime;
  if (!Number.isFinite(effectiveAt) || effectiveAt < 0) {
    throw new Error(`bulletin effectiveAt must be a non-negative finite number, received ${effectiveAt}`);
  }
  if (effectiveAt < input.currentSimulationTime) {
    throw new Error('bulletin effectiveAt must not be in the past');
  }
  return {
    bulletinId: input.bulletinId,
    title: input.title.trim(),
    body: input.body.trim(),
    priority: input.priority ?? 'normal',
    ...(input.authorAgentId === undefined ? {} : { authorAgentId: input.authorAgentId }),
    ...(input.authorSubjectId === undefined ? {} : { authorSubjectId: input.authorSubjectId }),
    postedAt: input.postedAt,
    effectiveAt,
  };
}

/** A bulletin becomes effective once the simulation clock reaches effectiveAt. */
export function isBulletinEffective(
  bulletin: TownBulletin,
  simulationTime: number,
): boolean {
  return bulletin.effectiveAt <= simulationTime;
}

export function cloneTownBulletin(bulletin: TownBulletin): TownBulletin {
  return {
    bulletinId: bulletin.bulletinId,
    title: bulletin.title,
    body: bulletin.body,
    priority: bulletin.priority,
    ...(bulletin.authorAgentId === undefined ? {} : { authorAgentId: bulletin.authorAgentId }),
    ...(bulletin.authorSubjectId === undefined ? {} : { authorSubjectId: bulletin.authorSubjectId }),
    postedAt: bulletin.postedAt,
    effectiveAt: bulletin.effectiveAt,
  };
}

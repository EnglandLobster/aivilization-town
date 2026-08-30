import type { AgentId } from '@aivilization/sim-core';
import {
  createDirectedSocialRelationKey,
  type SocialRelationState,
} from '@aivilization/society';
import type { WorldSocialMatterState } from './matters';
import type { WorldSocialCommitmentState } from './projection';

export const TOWN_CONFLICT_POLICY_VERSION = 'town-conflict-v2';

/**
 * Versioned town-conflict policy. The
 * world adjudicates every consequence — grievance issuance, hit, damage, and
 * social fallout are deterministic rules; no death (the lifecycle epic owns
 * that). Opt-in via the town-conflict switch: without the policy every
 * conflict command is rejected and no conflict state exists.
 *
 * The canonical Agent path is opt-in with the same switch: conflict records
 * enter the bounded decision view before its proposer can nominate an action,
 * while this world policy remains the only authority that can issue a
 * grievance or settle damage and fallout.
 */
export type TownConflictPolicy = {
  readonly policyVersion: string;
  /** Attack grievance: attacker→target relationScore must be below this. */
  readonly grievanceRelationThreshold: number;
  readonly baseDamage: number;
  /** Damage bonus per attacker energy point. */
  readonly attackerEnergyDamageFactor: number;
  /** Damage reduction per target energy point. */
  readonly targetEnergyDefenseFactor: number;
  readonly minDamage: number;
  readonly maxDamage: number;
  /** Energy the attacker spends per attack. */
  readonly attackerEnergyCost: number;
  /** Health floor after an attack — attacks incapacitate, never kill. */
  readonly minHealthAfterAttack: number;
  /** Fraction of the hostility deltas witnesses apply against the attacker. */
  readonly witnessAttitudePenaltyScale: number;
  /**
   * Optional wellbeing grievance shift (town-wellbeing interlock): when the
   * attacker carries a settled wellbeing, the strained-relation threshold
   * shifts by maxShift × (50 − wellbeing)/50 — distressed attackers lash out
   * at merely neutral relations, thriving ones need genuine hostility.
   * Betrayal evidence is never affected. Absent keeps the static threshold,
   * byte-for-byte identical to legacy runs.
   */
  readonly wellbeingGrievanceShift?: {
    readonly maxShift: number;
  };
};

/**
 * The world-issued justification an attack requires. Either the attacker
 * already strains against the target (relation below the grievance threshold)
 * or there is durable betrayal evidence (a breached commitment or a breached
 * social matter where the target wronged the attacker). No grievance, no
 * violence.
 */
export type ConflictGrievance =
  | {
      readonly kind: 'betrayal-evidence';
      readonly referenceId: string;
    }
  | {
      readonly kind: 'strained-relation';
      readonly relationScore: number;
    };

export type WorldConflictRecord = {
  readonly conflictId: string;
  readonly kind: 'confrontation' | 'attack' | 'intervention';
  readonly actorAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly counterpartyAgentId?: AgentId;
  readonly locationId: string;
  readonly damage?: number;
  readonly summary: string;
  readonly recordedAt: number;
};

export function resolveConflictGrievance(input: {
  readonly relations: Readonly<Record<string, SocialRelationState>>;
  readonly commitments: Readonly<Record<string, WorldSocialCommitmentState>>;
  readonly matters?: Readonly<Record<string, WorldSocialMatterState>>;
  readonly attackerAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly grievanceRelationThreshold: number;
  /** Attacker's settled wellbeing; absent skips the wellbeing shift entirely. */
  readonly attackerWellbeing?: number;
  readonly wellbeingGrievanceShift?: {
    readonly maxShift: number;
  };
}): ConflictGrievance | undefined {
  // Betrayal evidence outranks a merely strained relation: a breached
  // commitment or breached matter where the target wronged the attacker.
  const breachedCommitment = Object.values(input.commitments)
    .filter(
      (commitment) =>
        commitment.status === 'breached' &&
        commitment.promisorAgentId === input.targetAgentId &&
        commitment.beneficiaryAgentId === input.attackerAgentId,
    )
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.commitmentId.localeCompare(right.commitmentId)
        : left.createdAt - right.createdAt,
    )[0];
  if (breachedCommitment !== undefined) {
    return { kind: 'betrayal-evidence', referenceId: breachedCommitment.commitmentId };
  }
  const breachedMatter = Object.values(input.matters ?? {})
    .filter(
      (matter) =>
        matter.status === 'closed' &&
        matter.closure === 'breached' &&
        matter.assigneeAgentId === input.targetAgentId &&
        matter.initiatorAgentId === input.attackerAgentId,
    )
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.matterId.localeCompare(right.matterId)
        : left.createdAt - right.createdAt,
    )[0];
  if (breachedMatter !== undefined) {
    return { kind: 'betrayal-evidence', referenceId: breachedMatter.matterId };
  }
  const relationKey = createDirectedSocialRelationKey({
    sourceAgentId: input.attackerAgentId,
    targetAgentId: input.targetAgentId,
  });
  const relation = input.relations[relationKey];
  if (relation !== undefined) {
    const effectiveThreshold =
      input.wellbeingGrievanceShift === undefined || input.attackerWellbeing === undefined
        ? input.grievanceRelationThreshold
        : input.grievanceRelationThreshold +
          (input.wellbeingGrievanceShift.maxShift * (50 - input.attackerWellbeing)) / 50;
    if (relation.relationScore < effectiveThreshold) {
      return { kind: 'strained-relation', relationScore: relation.relationScore };
    }
  }
  return undefined;
}

/**
 * Deterministic damage: base plus attacker energy bonus minus target energy
 * defense, clamped to the policy band. Same inputs, same damage — no RNG.
 */
export function evaluateAttackDamage(input: {
  readonly policy: TownConflictPolicy;
  readonly attackerEnergy: number;
  readonly targetEnergy: number;
}): number {
  const raw =
    input.policy.baseDamage +
    input.attackerEnergy * input.policy.attackerEnergyDamageFactor -
    input.targetEnergy * input.policy.targetEnergyDefenseFactor;
  const clamped = Math.min(input.policy.maxDamage, Math.max(input.policy.minDamage, raw));
  return Number(clamped.toFixed(6));
}

export function applyAttackDamage(input: {
  readonly policy: TownConflictPolicy;
  readonly targetHealth: number;
  readonly damage: number;
}): number {
  return Number(
    Math.max(input.policy.minHealthAfterAttack, input.targetHealth - input.damage).toFixed(6),
  );
}

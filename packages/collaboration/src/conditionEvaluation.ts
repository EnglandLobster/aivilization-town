import {
  assertProgramConditionsPolicy,
  type ConditionEvidence,
  type ConditionScalar,
  type ProgramCondition,
  type ProgramConditionsPolicy,
  type ProgramConditionSource,
} from './conditionModel';
export type ConditionRead =
  | {
      accepted: true;
      value: ConditionScalar;
      sourceVersions: Readonly<Record<string, string | number>>;
      work: number;
    }
  | {
      accepted: false;
      reason:
        | 'condition-source-unavailable'
        | 'condition-work-budget-exceeded'
        | 'condition-evaluation-failed';
    };
export type ConditionReadPort = {
  readonly canRead: (source: ProgramConditionSource, actorId: string) => boolean;
  readonly read: (source: ProgramConditionSource, remainingWork: number) => ConditionRead;
};
export type ConditionEvaluation =
  | { accepted: true; matched: boolean; evidence: readonly ConditionEvidence[]; work: number }
  | { accepted: false; reason: string };
export function evaluateProgramConditions(input: {
  conditions: readonly ProgramCondition[];
  policy: ProgramConditionsPolicy;
  audiences: readonly string[];
  port: ConditionReadPort;
}): ConditionEvaluation {
  const { conditions, policy, audiences, port } = input;
  assertProgramConditionsPolicy(policy);
  if (conditions.length > policy.maxConditions)
    return { accepted: false, reason: 'condition-count-budget-exceeded' };
  // Complete authorization before returning any partial condition results.
  if (
    !audiences.length ||
    conditions.some((c) => audiences.some((a) => !port.canRead(c.source, a)))
  )
    return { accepted: false, reason: 'condition-source-unavailable' };
  const evidence: ConditionEvidence[] = [];
  let work = 0;
  for (const [index, c] of conditions.entries()) {
    if (work >= policy.maxWork)
      return { accepted: false, reason: 'condition-work-budget-exceeded' };
    const read = port.read(c.source, policy.maxWork - work);
    if (!read.accepted) return read;
    if (!Number.isSafeInteger(read.work) || read.work < 1 || work + read.work > policy.maxWork)
      return { accepted: false, reason: 'condition-work-budget-exceeded' };
    work += read.work;
    if (
      typeof read.value !== typeof c.value ||
      (typeof read.value === 'number' && !Number.isFinite(read.value))
    )
      return { accepted: false, reason: 'condition-evaluation-failed' };
    let matched: boolean;
    if (c.op === 'eq' || c.op === 'ne')
      matched = c.op === 'eq' ? read.value === c.value : read.value !== c.value;
    else {
      if (typeof read.value !== 'number' || typeof c.value !== 'number')
        return { accepted: false, reason: 'condition-evaluation-failed' };
      matched =
        c.op === 'lt'
          ? read.value < c.value
          : c.op === 'lte'
            ? read.value <= c.value
            : c.op === 'gt'
              ? read.value > c.value
              : read.value >= c.value;
    }
    const kind = c.source.kind;
    evidence.push({
      index,
      source: c.source,
      sourceVersions: { ...read.sourceVersions },
      matched,
      sourceClass:
        kind === 'record'
          ? 'resident-claim'
          : kind === 'statement'
            ? 'signed-claim'
            : kind === 'view'
              ? 'resident-computation'
              : kind === 'decision'
                ? 'procedural-fact'
                : 'world-fact',
    });
  }
  return { accepted: true, matched: evidence.every((e) => e.matched), evidence, work };
}

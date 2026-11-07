import {
  evaluateProgramConditions,
  programPrincipals,
  canReadCollectiveDecision,
  type ConditionRead,
  type ConditionReadPort,
  type ProgramConditionSource,
  type ResidentProgram,
} from '@aivilization/collaboration';
import { canReadRegister, sharedRecordKey } from '@aivilization/information';
import type { OpenSocietyState } from './types';
const unavailable = (): ConditionRead => ({
  accepted: false,
  reason: 'condition-source-unavailable',
});
export function conditionPort(state: OpenSocietyState): ConditionReadPort {
  const commonMember = (accountId: string, actorId: string) => {
    const a = state.world.commonAccounts?.accounts[accountId],
      c = a ? state.collectives?.charters[a.collectiveId] : undefined;
    return c?.status === 'active' && c.members.includes(actorId);
  };
  const canRead = (s: ProgramConditionSource, actor: string): boolean => {
    if (s.kind === 'clock') return true;
    if (s.kind === 'personal-fact')
      return s.actorId === actor && Object.hasOwn(state.world.agents, s.actorId);
    if (s.kind === 'common-balance') return commonMember(s.accountId, actor);
    if (s.kind === 'decision') {
      const d = state.collectives?.decisions[s.decisionId];
      return !!state.collectives && !!d && canReadCollectiveDecision(state.collectives, d, actor);
    }
    const r = state.sharedRecords?.registers[s.registerId];
    return !!r && canReadRegister(r, actor);
  };
  const read = (s: ProgramConditionSource, remainingWork: number): ConditionRead => {
    if (remainingWork < 1) return { accepted: false, reason: 'condition-work-budget-exceeded' };
    if (s.kind === 'clock')
      return {
        accepted: true,
        value: state.world.clock.now,
        sourceVersions: { simulationTime: state.world.clock.now },
        work: 1,
      };
    if (s.kind === 'personal-fact') {
      const a = state.world.agents[s.actorId];
      if (!a) return unavailable();
      const value =
        s.field === 'balance'
          ? a.balance
          : s.field === 'locationId'
            ? a.locationId
            : s.field === 'availableAt'
              ? Math.max(
                  state.world.activityTimeByAgent[s.actorId]?.availableAt ?? 0,
                  state.world.transitByAgent?.[s.actorId]?.arrivesAt ?? 0,
                )
              : s.commodity === undefined
                ? undefined
                : (a.inventory[s.commodity] ?? 0);
      return typeof value === 'number' || typeof value === 'string'
        ? {
            accepted: true,
            value,
            sourceVersions: {
              worldSequence: state.worldSequence,
              simulationTime: state.world.clock.now,
            },
            work: 1,
          }
        : unavailable();
    }
    if (s.kind === 'common-balance') {
      const a = state.world.commonAccounts?.accounts[s.accountId];
      if (!a || a.controlVersion !== s.controlVersion) return unavailable();
      return {
        accepted: true,
        value: a.balance,
        sourceVersions: { accountRevision: a.revision, controlVersion: a.controlVersion },
        work: 1,
      };
    }
    if (s.kind === 'decision') {
      const d = state.collectives?.decisions[s.decisionId],
        c = d ? state.collectives?.charters[d.collectiveId] : undefined;
      if (
        !d ||
        !c ||
        c.status !== 'active' ||
        c.version !== s.charterVersion ||
        d.charterVersion !== s.charterVersion ||
        d.status === 'expired' ||
        (d.status === 'passed' &&
          d.action.kind !== 'statement' &&
          state.world.clock.now >= d.executeBefore)
      )
        return unavailable();
      return {
        accepted: true,
        value: d.status,
        sourceVersions: { decisionRevision: d.revision, charterVersion: d.charterVersion },
        work: 1,
      };
    }
    const records = state.sharedRecords,
      r = records?.records[sharedRecordKey(s.registerId, s.key)],
      register = records?.registers[s.registerId];
    if (
      !r ||
      !register ||
      r.deleted ||
      (s.revision !== 'latest' && s.revision !== r.revision) ||
      !Object.hasOwn(r.values, s.field)
    )
      return unavailable();
    if (s.kind === 'statement' && (r.editedBy !== s.signerId || r.authorityId !== s.signerId))
      return unavailable();
    return {
      accepted: true,
      value: r.values[s.field]!,
      sourceVersions: { recordRevision: r.revision, registerRevision: register.revision },
      work: 1,
    };
  };
  return { canRead, read };
}
export function checkResidentProgramConditions(state: OpenSocietyState, program: ResidentProgram) {
  if (program.conditions === undefined)
    return { accepted: true as const, matched: true, evidence: [], work: 0 };
  const policy = state.coordination?.conditionsPolicy;
  if (!policy || program.conditionPolicyVersion !== policy.version)
    return { accepted: false as const, reason: 'unsupported-program-condition-policy' };
  return evaluateProgramConditions({
    conditions: program.conditions,
    policy,
    audiences: [...new Set([program.ownerId, ...program.runners, ...programPrincipals(program)])],
    port: conditionPort(state),
  });
}

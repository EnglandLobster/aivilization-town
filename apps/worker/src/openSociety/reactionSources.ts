import {
  prepareProgramRun,
  programPrincipals,
  type ResidentProgram,
  type ProgramConditionSource,
} from '@aivilization/collaboration';
import { sharedRecordKey, sharedRegisterRecords } from '@aivilization/information';
import type { OpenSocietyState } from './types';
import { conditionPort } from './programConditions';
import { digest } from './journal';
export type ReactionSourceCache = Map<string, string>;
/** Only permission-checked source versions/values enter this internal hash; it is never a resident result. */
export function reactionSourceToken(
  state: OpenSocietyState,
  program: ResidentProgram,
  runnerId: string,
  cache: ReactionSourceCache = new Map(),
) {
  const port = conditionPort(state, program.ownerId),
    audiences = [...new Set([program.ownerId, ...program.runners, ...programPrincipals(program)])],
    conditions = program.conditions ?? [];
  if (!conditions.every((c) => audiences.every((a) => port.canRead(c.source, a))))
    return { accepted: false as const, reason: 'condition-source-unavailable' };
  const source = (s: ProgramConditionSource): unknown => {
    if (s.kind === 'clock') return { kind: 'clock' }; // Existing schedules own clock-trigger semantics.
    if (s.kind === 'personal-fact') {
      const r = port.read(s, 1);
      return r.accepted ? { source: s, value: r.value } : { source: s, unavailable: true };
    }
    if (s.kind === 'common-balance') {
      const a = state.world.commonAccounts?.accounts[s.accountId];
      return {
        source: s,
        revision: a?.revision ?? 0,
        charterVersion: a ? (state.collectives?.charters[a.collectiveId]?.version ?? 0) : 0,
      };
    }
    if (s.kind === 'decision') {
      const d = state.collectives?.decisions[s.decisionId];
      return {
        source: s,
        revision: d?.revision ?? 0,
        charterVersion: d ? (state.collectives?.charters[d.collectiveId]?.version ?? 0) : 0,
      };
    }
    if (s.kind === 'view') {
      const v = state.recordViews?.views[s.viewId],
        registerId = v?.definition.sourceRegisterId;
      let dataToken = registerId ? cache.get(registerId) : undefined;
      if (registerId && dataToken === undefined) {
        const rs = state.sharedRecords;
        const records = (rs ? sharedRegisterRecords(rs, registerId) : [])
          .map((r) => [r.key, r.revision])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en'));
        dataToken = digest(records);
        cache.set(registerId, dataToken);
      }
      return {
        source: s,
        revision: v?.revision ?? 0,
        registerRevision: registerId
          ? (state.sharedRecords?.registers[registerId]?.revision ?? 0)
          : 0,
        dataToken: dataToken ?? null,
      };
    }
    return {
      source: s,
      registerRevision: state.sharedRecords?.registers[s.registerId]?.revision ?? 0,
      recordRevision:
        state.sharedRecords?.records[sharedRecordKey(s.registerId, s.key)]?.revision ?? 0,
    };
  };
  const s = state.coordination;
  const check = s
    ? prepareProgramRun(s, runnerId, program.id, program.revision, state.world.clock.now, (id) =>
        Object.hasOwn(state.world.agents, id),
      )
    : undefined;
  return {
    accepted: true as const,
    token: digest({
      programRevision: program.revision,
      active: program.active,
      authority:
        check?.accepted === true ? 'available' : (check?.reason ?? 'coordination-unavailable'),
      sources: conditions.map((c) => source(c.source)),
    }),
  };
}

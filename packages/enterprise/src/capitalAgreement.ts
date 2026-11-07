import { sameController, type ControlAuthorizationPort } from '@aivilization/authority';
import {
  CAPITAL_AGREEMENTS_POLICY as policy,
  capitalAccountKey,
  type CapitalAccount,
  type CapitalPosition,
  type CapitalAuthority,
  type CapitalAgreement,
  type CapitalEvent,
  type CapitalFlow,
  type CapitalCommand,
  type CapitalAccess,
  type CapitalManagement,
  type EnterpriseCapitalState,
} from './capitalModel';
import {
  assertCapitalAgreement,
  assertCapitalAuthority,
  assertCapitalPositions,
  assertEnterpriseCapitalState,
  capitalId,
  capitalTime,
  capitalFactsEqual,
} from './capitalValidation';

export function initialEnterpriseCapital(
  positions: readonly CapitalPosition[],
): EnterpriseCapitalState {
  assertCapitalPositions(positions);
  return {
    policyVersion: policy.version,
    equityVersion: 1,
    initialPositions: structuredClone(positions),
    positions: structuredClone(positions),
    agreements: {},
  };
}
function participants(
  s: EnterpriseCapitalState,
  a: Pick<CapitalAgreement, 'positions' | 'contributions' | 'disbursements'>,
): readonly CapitalAccount[] {
  const all = [
    ...s.positions.map((p) => p.account),
    ...a.positions.map((p) => p.account),
    ...a.contributions.map((p) => p.account),
    ...a.disbursements.flatMap((p) => (p.account.sector === 'enterprise' ? [] : [p.account])),
  ];
  return [...new Map(all.map((a) => [capitalAccountKey(a), a])).entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([, a]) => a);
}
export const capitalNeedsManagement = (a: CapitalAgreement): boolean =>
  a.disbursements.some((d) => d.account.sector === 'enterprise');
export function capitalHeldMicros(a: CapitalAgreement): number {
  return a.status === 'proposed'
    ? a.contributions
        .filter((c) => Object.hasOwn(a.consents, capitalAccountKey(c.account)))
        .reduce((sum, c) => sum + c.amountMicros, 0)
    : 0;
}
const refundFlows = (a: CapitalAgreement): readonly CapitalFlow[] =>
  a.contributions
    .filter((c) => Object.hasOwn(a.consents, capitalAccountKey(c.account)))
    .map((c) => ({ from: { sector: 'escrow' }, to: c.account, amountMicros: c.amountMicros }));
function unchangedTerms(before: CapitalAgreement, after: CapitalAgreement) {
  const immutable = (a: CapitalAgreement) => ({
    id: a.id,
    proposedBy: a.proposedBy,
    proposerAuthority: a.proposerAuthority,
    proposedAt: a.proposedAt,
    expiresAt: a.expiresAt,
    terms: a.terms,
    equityVersion: a.equityVersion,
    positions: a.positions,
    contributions: a.contributions,
    disbursements: a.disbursements,
    participants: a.participants,
  });
  if (!capitalFactsEqual(immutable(before), immutable(after)))
    throw Error('capital-agreement-terms-changed');
}
/** Owning reducer validates transitions and their mechanical transfers; it never resolves live external authorization. */
export function applyCapitalEvent(
  s: EnterpriseCapitalState,
  e: CapitalEvent,
): EnterpriseCapitalState {
  assertEnterpriseCapitalState(s);
  assertCapitalAgreement(e.agreement);
  const a = e.agreement,
    old = s.agreements[a.id];
  if (
    e.type !== 'EnterpriseCapitalAgreementChanged' ||
    e.policyVersion !== policy.version ||
    !capitalTime(e.at) ||
    e.at < a.proposedAt ||
    !capitalId(e.actorId) ||
    (e.actorId === 'system' && e.operation !== 'cancel') ||
    e.previousRevision !== (old?.revision ?? 0) ||
    a.revision !== e.previousRevision + 1
  )
    throw Error('capital-event-source-mismatch');
  let flows: readonly CapitalFlow[] = [];
  let positions = s.positions,
    equityVersion = s.equityVersion;
  if (e.operation === 'propose') {
    if (
      old ||
      a.equityVersion !== s.equityVersion ||
      a.proposedBy !== e.actorId ||
      a.proposedAt !== e.at ||
      a.status !== 'proposed' ||
      Object.keys(a.consents).length ||
      a.management ||
      !capitalFactsEqual(a.participants, participants(s, a)) ||
      Object.keys(s.agreements).length >= policy.maxAgreements ||
      Object.values(s.agreements).filter((v) => v.status === 'proposed').length >=
        policy.maxOpenAgreements
    )
      throw Error('invalid-capital-proposal-event');
  } else {
    if (!old || old.status !== 'proposed') throw Error('capital-agreement-not-open');
    unchangedTerms(old, a);
    const live = e.at < old.expiresAt && old.equityVersion === s.equityVersion;
    if (e.operation === 'accept') {
      const added = Object.keys(a.consents).filter((k) => !Object.hasOwn(old.consents, k));
      if (
        !live ||
        added.length !== 1 ||
        a.status !== 'proposed' ||
        !capitalFactsEqual(a.management, old.management) ||
        Object.entries(old.consents).some(([k, v]) => !capitalFactsEqual(v, a.consents[k]))
      )
        throw Error('invalid-capital-acceptance-event');
      const key = added[0]!,
        consent = a.consents[key]!;
      if (consent.at !== e.at || consent.authority.actorId !== e.actorId)
        throw Error('capital-consent-source-mismatch');
      const contribution = a.contributions.find((c) => capitalAccountKey(c.account) === key);
      if (contribution)
        flows = [
          {
            from: contribution.account,
            to: { sector: 'escrow' },
            amountMicros: contribution.amountMicros,
          },
        ];
    } else if (e.operation === 'authorize') {
      if (
        !live ||
        !capitalNeedsManagement(a) ||
        a.status !== 'proposed' ||
        !a.management ||
        a.management.at !== e.at ||
        a.management.authority.actorId !== e.actorId ||
        !capitalFactsEqual(a.consents, old.consents)
      )
        throw Error('invalid-capital-management-event');
    } else if (e.operation === 'execute') {
      if (
        !live ||
        a.status !== 'executed' ||
        a.endedAt !== e.at ||
        a.endReason !== 'completed' ||
        !capitalFactsEqual(a.consents, old.consents) ||
        !capitalFactsEqual(a.management, old.management) ||
        Object.keys(old.consents).length !== old.participants.length ||
        (capitalNeedsManagement(old) && !old.management) ||
        !Number.isSafeInteger(s.equityVersion + 1)
      )
        throw Error('invalid-capital-execution-event');
      flows = a.disbursements.map((d) => ({
        from: { sector: 'escrow' },
        to: d.account,
        amountMicros: d.amountMicros,
      }));
      positions = a.positions;
      equityVersion++;
    } else if (e.operation === 'cancel') {
      const reason =
        e.at >= old.expiresAt
          ? 'expired'
          : old.equityVersion !== s.equityVersion
            ? 'equity-version-changed'
            : 'withdrawn';
      if (
        a.status !== 'cancelled' ||
        a.endedAt !== e.at ||
        a.endReason !== reason ||
        !capitalFactsEqual(a.consents, old.consents) ||
        !capitalFactsEqual(a.management, old.management) ||
        (e.actorId === 'system' && reason === 'withdrawn')
      )
        throw Error('invalid-capital-cancellation-event');
      flows = refundFlows(old);
    } else throw Error('unsupported-capital-operation');
  }
  if (!capitalFactsEqual(e.flows, flows)) throw Error('capital-event-transfers-mismatch');
  const next = {
    ...s,
    positions: structuredClone(positions),
    equityVersion,
    agreements: { ...s.agreements, [a.id]: structuredClone(a) },
  };
  assertEnterpriseCapitalState(next);
  return next;
}
export function decideCapitalAgreement(input: {
  state: EnterpriseCapitalState;
  actorId: string;
  at: number;
  command: CapitalCommand;
  management: CapitalManagement;
  account: (a: CapitalAccount) => CapitalAccess | undefined;
  authorize: ControlAuthorizationPort;
}): { accepted: true; events: readonly CapitalEvent[] } | { accepted: false; reason: string } {
  const { state: s, actorId: actor, at, command: c } = input,
    no = (reason: string) => ({ accepted: false as const, reason });
  try {
    assertEnterpriseCapitalState(s);
    if (!capitalId(actor) || actor === 'system' || !capitalTime(at) || !capitalId(c.id))
      return no('invalid-capital-command');
    const authority = (
      controller: CapitalManagement['controller'],
    ): CapitalAuthority | undefined => {
      const grant = input.authorize(controller);
      if (!grant || grant.actorId !== actor) return undefined;
      const proof = {
        actorId: actor,
        controller,
        ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
      };
      assertCapitalAuthority(proof);
      return proof;
    };
    const controls = (a: CapitalAccount) => {
      const access = input.account(a);
      return access && authority(access.controller);
    };
    const commit = (
      operation: CapitalEvent['operation'],
      agreement: CapitalAgreement,
      flows: readonly CapitalFlow[] = [],
    ): { accepted: true; events: readonly CapitalEvent[] } => {
      const event: CapitalEvent = {
        type: 'EnterpriseCapitalAgreementChanged',
        policyVersion: policy.version,
        operation,
        actorId: actor,
        at,
        previousRevision: agreement.revision - 1,
        agreement,
        flows,
      };
      applyCapitalEvent(s, event);
      return { accepted: true, events: [event] };
    };
    if (c.type === 'propose') {
      if (s.agreements[c.id]) return no('capital-agreement-already-exists');
      if (c.expectedEquityVersion !== s.equityVersion) return no('capital-equity-version-conflict');
      const proposerAuthority =
        authority(input.management.controller) ??
        s.positions.map((p) => controls(p.account)).find((p) => p !== undefined);
      if (!proposerAuthority) return no('capital-participant-or-manager-required');
      const proposed: CapitalAgreement = {
        id: c.id,
        revision: 1,
        proposedBy: actor,
        proposerAuthority,
        proposedAt: at,
        expiresAt: c.expiresAt,
        terms: c.terms,
        equityVersion: s.equityVersion,
        positions: structuredClone(c.positions),
        contributions: structuredClone(c.contributions),
        disbursements: structuredClone(c.disbursements),
        participants: participants(s, c),
        consents: {},
        status: 'proposed',
      };
      assertCapitalAgreement(proposed);
      if (proposed.participants.some((a) => !input.account(a)))
        return no('capital-participant-account-unavailable');
      if (
        !s.positions.some((p) => !!controls(p.account)) &&
        !authority(input.management.controller)
      )
        return no('capital-participant-or-manager-required');
      return commit('propose', proposed);
    }
    const old = s.agreements[c.id];
    if (!old) return no('capital-agreement-not-found');
    if (c.expectedRevision !== old.revision) return no('capital-agreement-revision-conflict');
    if (old.status !== 'proposed') return no('capital-agreement-not-open');
    if (!Number.isSafeInteger(old.revision + 1)) return no('capital-revision-exhausted');
    if (c.type === 'cancel') {
      if (
        !authority(old.proposerAuthority.controller) &&
        !old.participants.some((a) => !!controls(a))
      )
        return no('capital-participant-required');
      return commit(
        'cancel',
        {
          ...old,
          revision: old.revision + 1,
          status: 'cancelled',
          endedAt: at,
          endReason:
            at >= old.expiresAt
              ? 'expired'
              : old.equityVersion !== s.equityVersion
                ? 'equity-version-changed'
                : 'withdrawn',
        },
        refundFlows(old),
      );
    }
    if (at >= old.expiresAt) return no('capital-agreement-expired');
    if (old.equityVersion !== s.equityVersion) return no('capital-equity-version-conflict');
    if (c.type === 'accept') {
      const key = capitalAccountKey(c.account),
        proof = controls(c.account),
        access = input.account(c.account);
      if (!old.participants.some((a) => capitalAccountKey(a) === key) || !proof || !access)
        return no('capital-account-authority-required');
      if (old.consents[key]) return no('capital-account-already-accepted');
      const contribution = old.contributions.find((v) => capitalAccountKey(v.account) === key);
      if (
        contribution &&
        (!access.open ||
          !Number.isSafeInteger(access.balanceMicros) ||
          access.balanceMicros < contribution.amountMicros)
      )
        return no('capital-contribution-unfunded');
      return commit(
        'accept',
        {
          ...old,
          revision: old.revision + 1,
          consents: { ...old.consents, [key]: { authority: proof, at } },
        },
        contribution
          ? [
              {
                from: contribution.account,
                to: { sector: 'escrow' },
                amountMicros: contribution.amountMicros,
              },
            ]
          : [],
      );
    }
    if (c.type === 'authorize') {
      const proof = authority(input.management.controller);
      if (
        !proof ||
        c.expectedControlVersion !== input.management.controlVersion ||
        !capitalNeedsManagement(old)
      )
        return no('capital-management-authority-required');
      return commit('authorize', {
        ...old,
        revision: old.revision + 1,
        management: { authority: proof, controlVersion: input.management.controlVersion, at },
      });
    }
    if (c.type === 'execute') {
      if (!old.participants.some((a) => !!controls(a))) return no('capital-participant-required');
      if (Object.keys(old.consents).length !== old.participants.length)
        return no('capital-independent-consents-required');
      if (
        capitalNeedsManagement(old) &&
        (!old.management ||
          old.management.controlVersion !== input.management.controlVersion ||
          !sameController(old.management.authority.controller, input.management.controller))
      )
        return no('capital-current-management-consent-required');
      if (old.participants.some((a) => !input.account(a)))
        return no('capital-participant-account-unavailable');
      return commit(
        'execute',
        {
          ...old,
          revision: old.revision + 1,
          status: 'executed',
          endedAt: at,
          endReason: 'completed',
        },
        old.disbursements.map((d) => ({
          from: { sector: 'escrow' },
          to: d.account,
          amountMicros: d.amountMicros,
        })),
      );
    }
    return no('unsupported-capital-command');
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-capital-command');
  }
}
/** Only expiry or an already superseded capital source can trigger automatic refund, never presumed consent. */
export function expireCapitalAgreements(
  s: EnterpriseCapitalState,
  at: number,
): readonly CapitalEvent[] {
  if (!capitalTime(at)) throw Error('invalid-capital-settlement-time');
  const events: CapitalEvent[] = [];
  let working = s;
  for (const a of Object.values(s.agreements).sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    if (a.status !== 'proposed' || (at < a.expiresAt && a.equityVersion === working.equityVersion))
      continue;
    const event: CapitalEvent = {
      type: 'EnterpriseCapitalAgreementChanged',
      policyVersion: policy.version,
      operation: 'cancel',
      actorId: 'system',
      at,
      previousRevision: a.revision,
      agreement: {
        ...a,
        revision: a.revision + 1,
        status: 'cancelled',
        endedAt: at,
        endReason: at >= a.expiresAt ? 'expired' : 'equity-version-changed',
      },
      flows: refundFlows(a),
    };
    working = applyCapitalEvent(working, event);
    events.push(event);
  }
  return events;
}

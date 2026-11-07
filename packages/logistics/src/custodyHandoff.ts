import {
  authorizeController,
  validController,
  validControllerId,
  type Controller,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { freightFactsEqual } from './facts';
import { loadedFreight, type Freight } from './model';
export const FREIGHT_CUSTODY_COLLECTIVE_VERSION = 'freight-custody-collective-grants-v1' as const;
export const FREIGHT_CUSTODY_HANDOFF_VERSION = 'freight-custody-handoff-v1' as const;
export const FREIGHT_CUSTODY_HANDOFF_POLICY = {
  version: FREIGHT_CUSTODY_HANDOFF_VERSION,
  maxWindowMs: 86400000,
  maxProposals: 10000,
} as const;
export type CustodyConsentRole = 'source' | 'recipient' | 'payer' | 'previous-carrier';
export type CustodyDepartureReference = {
  readonly actorId: string;
  readonly populationEventId: string;
  readonly at: number;
};
export type FreightCustodyHandoff = {
  readonly version: typeof FREIGHT_CUSTODY_HANDOFF_VERSION;
  readonly id: string;
  readonly freightId: string;
  readonly createdBy: string;
  readonly createdByCollectiveId?: string;
  readonly withdrawalAuthority?: { readonly collectiveId: string; readonly decisionId: string };
  readonly freightRevision: number;
  readonly previousCarrierId: string;
  readonly nextCarrierId: string;
  readonly vehicleId?: string;
  readonly principals: Readonly<Record<CustodyConsentRole, Controller>>;
  readonly consents: Partial<
    Readonly<Record<CustodyConsentRole, { readonly actorId: string; readonly decisionId?: string }>>
  >;
  readonly departure?: CustodyDepartureReference;
  readonly expiresAt: number;
  readonly revision: number;
  readonly at: number;
  readonly status: 'proposed' | 'accepted' | 'withdrawn';
  readonly lastActorId: string;
};
export type FreightCustodyState = {
  readonly collectiveGrantsVersion?: typeof FREIGHT_CUSTODY_COLLECTIVE_VERSION;
  readonly proposals: Readonly<Record<string, FreightCustodyHandoff>>;
  readonly holders: Readonly<
    Record<
      string,
      { readonly carrierId: string; readonly vehicleId?: string; readonly handoffId: string }
    >
  >;
};
export type FreightCustodyEvent = {
  readonly type: 'FreightCustodyHandoffChanged';
  readonly value: FreightCustodyHandoff;
};
export type FreightCustodyPorts = {
  readonly collectiveConsentValid?: (
    proposal: FreightCustodyHandoff,
    role: CustodyConsentRole,
  ) => boolean;
  readonly authorize: ControlAuthorizationPort;
  readonly exists: (id: string) => boolean;
  readonly payerController: (f: Freight) => Controller | undefined;
  readonly departure: (id: string) => CustodyDepartureReference | undefined;
  /** Owning application verifies actual shared position, vehicle authorization and load; undefined means allowed. */
  readonly takingFailure: (
    f: Freight,
    previousCarrierId: string,
    nextCarrierId: string,
    vehicleId: string | undefined,
  ) => string | undefined;
};
export type FreightCustodyCommand =
  | {
      readonly type: 'propose';
      readonly id: string;
      readonly nextCarrierId: string;
      readonly vehicleId?: string;
      readonly expiresAt: number;
    }
  | {
      readonly type: 'consent';
      readonly id: string;
      readonly expectedRevision: number;
      readonly role: CustodyConsentRole;
    }
  | {
      readonly type: 'accept' | 'withdraw';
      readonly id: string;
      readonly expectedRevision: number;
    };
const roles: readonly CustodyConsentRole[] = ['source', 'recipient', 'payer', 'previous-carrier'];
export const emptyFreightCustodyState = (): FreightCustodyState => ({ proposals: {}, holders: {} });
/** Original contract carrier/fee beneficiary is never changed by physical custody delegation. */
export function freightCustodian(s: FreightCustodyState | undefined, f: Freight) {
  return (
    s?.holders[f.id] ?? {
      carrierId: f.carrierId,
      ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    }
  );
}
export function decideFreightCustody(input: {
  state: FreightCustodyState;
  freight: Freight;
  actorId: string;
  at: number;
  command: FreightCustodyCommand;
  ports: FreightCustodyPorts;
}): { accepted: true; event: FreightCustodyEvent } | { accepted: false; reason: string } {
  const { state: s, freight: f, actorId: actor, at, command: c, ports: p } = input;
  const no = (reason: string) => ({ accepted: false as const, reason });
  const yes = (value: FreightCustodyHandoff) => ({
    accepted: true as const,
    event: { type: 'FreightCustodyHandoffChanged' as const, value },
  });
  if (
    !p.exists(actor) ||
    !Number.isSafeInteger(at) ||
    at < f.at ||
    !validControllerId(c.id) ||
    !loadedFreight(f)
  )
    return no('custody-live-actor-loaded-freight-required');
  if (
    s.collectiveGrantsVersion !== undefined &&
    s.collectiveGrantsVersion !== FREIGHT_CUSTODY_COLLECTIVE_VERSION
  )
    return no('unsupported-custody-collective-policy');
  const holder = freightCustodian(s, f),
    payer = p.payerController(f);
  if (!payer || !validController(payer)) return no('custody-payer-principal-unavailable');
  if (c.type === 'propose') {
    if (
      s.proposals[c.id] ||
      !validControllerId(c.nextCarrierId) ||
      !p.exists(c.nextCarrierId) ||
      c.nextCarrierId === holder.carrierId ||
      (c.vehicleId !== undefined && !validControllerId(c.vehicleId)) ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= at ||
      c.expiresAt - at > FREIGHT_CUSTODY_HANDOFF_POLICY.maxWindowMs ||
      Object.keys(s.proposals).length >= FREIGHT_CUSTODY_HANDOFF_POLICY.maxProposals
    )
      return no('invalid-custody-proposal');
    if (actor !== holder.carrierId && !authorizeController(f.controller, actor, p.authorize))
      return no('custody-source-or-current-carrier-required');
    const departure = p.exists(holder.carrierId) ? undefined : p.departure(holder.carrierId);
    if (
      !p.exists(holder.carrierId) &&
      (!departure ||
        departure.actorId !== holder.carrierId ||
        !departure.populationEventId ||
        !Number.isSafeInteger(departure.at) ||
        departure.at > at ||
        departure.at < 0)
    )
      return no('custody-original-carrier-departure-required');
    return yes({
      version: FREIGHT_CUSTODY_HANDOFF_VERSION,
      id: c.id,
      freightId: f.id,
      createdBy: actor,
      ...(s.collectiveGrantsVersion &&
      f.controller.kind === 'collective' &&
      authorizeController(f.controller, actor, p.authorize)
        ? { createdByCollectiveId: f.controller.id }
        : {}),
      freightRevision: f.revision,
      previousCarrierId: holder.carrierId,
      nextCarrierId: c.nextCarrierId,
      ...(c.vehicleId ? { vehicleId: c.vehicleId } : {}),
      principals: {
        source: f.controller,
        recipient: f.recipient,
        payer,
        'previous-carrier': { kind: 'resident', id: holder.carrierId },
      },
      consents: {},
      ...(departure ? { departure } : {}),
      expiresAt: c.expiresAt,
      revision: 1,
      at,
      status: 'proposed',
      lastActorId: actor,
    });
  }
  const old = s.proposals[c.id];
  if (
    !old ||
    old.status !== 'proposed' ||
    old.revision !== c.expectedRevision ||
    old.revision >= Number.MAX_SAFE_INTEGER ||
    old.at > at ||
    old.expiresAt <= at ||
    old.freightId !== f.id ||
    old.freightRevision !== f.revision ||
    old.previousCarrierId !== holder.carrierId ||
    !freightFactsEqual(old.principals.source, f.controller) ||
    !freightFactsEqual(old.principals.recipient, f.recipient) ||
    !freightFactsEqual(old.principals.payer, payer)
  )
    return no('custody-proposal-stale');
  if (
    old.departure &&
    (p.exists(old.previousCarrierId) ||
      !freightFactsEqual(p.departure(old.previousCarrierId), old.departure))
  )
    return no('custody-departure-source-changed');
  if (c.type === 'withdraw') {
    const collective = s.collectiveGrantsVersion
      ? roles.flatMap((role) => {
          const principal = old.principals[role];
          const auth =
            principal.kind === 'collective'
              ? authorizeController(principal, actor, p.authorize)
              : undefined;
          return auth?.decisionId
            ? [{ collectiveId: principal.id, decisionId: auth.decisionId }]
            : [];
        })[0]
      : undefined;
    const personal =
      actor === old.nextCarrierId ||
      (actor === old.createdBy && !old.createdByCollectiveId) ||
      roles.some(
        (role) =>
          old.consents[role]?.actorId === actor &&
          (!s.collectiveGrantsVersion || old.principals[role].kind === 'resident'),
      );
    if (!personal && !collective) return no('custody-withdrawal-party-required');
    return yes({
      ...old,
      revision: old.revision + 1,
      at,
      lastActorId: actor,
      status: 'withdrawn',
      ...(collective ? { withdrawalAuthority: collective } : {}),
    });
  }
  if (c.type === 'consent') {
    if (
      !roles.includes(c.role) ||
      old.consents[c.role] ||
      (c.role === 'previous-carrier' && old.departure)
    )
      return no('custody-consent-not-applicable');
    const auth = authorizeController(old.principals[c.role], actor, p.authorize);
    if (!auth) return no('custody-principal-consent-required');
    return yes({
      ...old,
      revision: old.revision + 1,
      at,
      lastActorId: actor,
      consents: {
        ...old.consents,
        [c.role]: { actorId: actor, ...(auth.decisionId ? { decisionId: auth.decisionId } : {}) },
      },
    });
  }
  if (actor !== old.nextCarrierId) return no('custody-successor-personal-acceptance-required');
  if (roles.some((role) => !(role === 'previous-carrier' && old.departure) && !old.consents[role]))
    return no('custody-independent-consents-required');
  for (const role of roles) {
    if (role === 'previous-carrier' && old.departure) continue;
    const consent = old.consents[role]!;
    if (s.collectiveGrantsVersion && old.principals[role].kind === 'collective') {
      if (!p.collectiveConsentValid?.(old, role))
        return no('custody-consent-authority-no-longer-valid');
      continue;
    }

    const auth = authorizeController(old.principals[role], consent.actorId, p.authorize);
    if (!p.exists(consent.actorId) || !auth || auth.decisionId !== consent.decisionId)
      return no('custody-consent-authority-no-longer-valid');
  }
  const failure = p.takingFailure(f, holder.carrierId, actor, old.vehicleId);
  if (failure) return no(failure);
  return yes({ ...old, revision: old.revision + 1, at, lastActorId: actor, status: 'accepted' });
}
/** Replay validates recorded state transitions; the world must verify external authority and physical evidence atomically. */
export function applyFreightCustodyEvent(
  s: FreightCustodyState,
  f: Freight,
  e: FreightCustodyEvent,
): FreightCustodyState {
  if (
    s.collectiveGrantsVersion !== undefined &&
    s.collectiveGrantsVersion !== FREIGHT_CUSTODY_COLLECTIVE_VERSION
  )
    throw Error('unsupported-custody-collective-policy');
  const v = e.value,
    old = s.proposals[v.id],
    holder = freightCustodian(s, f);
  if (
    e.type !== 'FreightCustodyHandoffChanged' ||
    v.version !== FREIGHT_CUSTODY_HANDOFF_VERSION ||
    !loadedFreight(f) ||
    v.freightId !== f.id ||
    v.freightRevision !== f.revision ||
    v.previousCarrierId !== holder.carrierId ||
    v.nextCarrierId === holder.carrierId ||
    !validControllerId(v.id) ||
    !validControllerId(v.createdBy) ||
    !validControllerId(v.lastActorId) ||
    !validController(v.principals.payer) ||
    !validControllerId(v.nextCarrierId) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision !== (old?.revision ?? 0) + 1 ||
    !Number.isSafeInteger(v.at) ||
    v.at < (old?.at ?? f.at) ||
    !Number.isSafeInteger(v.expiresAt) ||
    v.expiresAt <= v.at ||
    v.expiresAt - v.at > FREIGHT_CUSTODY_HANDOFF_POLICY.maxWindowMs ||
    !freightFactsEqual(v.principals.source, f.controller) ||
    !freightFactsEqual(v.principals.recipient, f.recipient) ||
    !freightFactsEqual(v.principals['previous-carrier'], { kind: 'resident', id: holder.carrierId })
  )
    throw Error('invalid-custody-handoff-event');
  if (
    (v.createdByCollectiveId !== undefined &&
      (!s.collectiveGrantsVersion ||
        v.createdByCollectiveId !== f.controller.id ||
        f.controller.kind !== 'collective')) ||
    (v.withdrawalAuthority &&
      (!s.collectiveGrantsVersion ||
        v.status !== 'withdrawn' ||
        !validControllerId(v.withdrawalAuthority.decisionId) ||
        !roles.some(
          (role) =>
            v.principals[role].kind === 'collective' &&
            v.principals[role].id === v.withdrawalAuthority!.collectiveId,
        )))
  )
    throw Error('invalid-custody-collective-authority');
  if (
    v.departure &&
    (v.departure.actorId !== holder.carrierId ||
      !v.departure.populationEventId ||
      !Number.isSafeInteger(v.departure.at) ||
      v.departure.at < 0 ||
      v.departure.at > v.at)
  )
    throw Error('invalid-custody-departure-reference');
  if (!old) {
    if (Object.keys(s.proposals).length >= FREIGHT_CUSTODY_HANDOFF_POLICY.maxProposals)
      throw Error('custody-proposal-capacity');
    if (v.status !== 'proposed' || v.lastActorId !== v.createdBy || Object.keys(v.consents).length)
      throw Error('invalid-custody-proposal-event');
  } else {
    if (
      old.status !== 'proposed' ||
      !freightFactsEqual(
        {
          ...withoutWithdrawalAuthority(v),
          revision: old.revision,
          at: old.at,
          status: old.status,
          consents: old.consents,
          lastActorId: old.lastActorId,
        },
        withoutWithdrawalAuthority(old),
      )
    )
      throw Error('custody-proposal-terms-changed');
    const added = roles.filter((role) => !old.consents[role] && v.consents[role]);
    if (
      Object.keys(v.consents).some((role) => !roles.includes(role as CustodyConsentRole)) ||
      roles.some(
        (role) => old.consents[role] && !freightFactsEqual(old.consents[role], v.consents[role]),
      )
    )
      throw Error('custody-consent-rewritten');
    if (v.status === 'proposed') {
      if (added.length !== 1) throw Error('custody-one-consent-required');
      const role = added[0]!,
        consent = v.consents[role]!,
        principal = v.principals[role];
      if (
        (role === 'previous-carrier' && v.departure) ||
        !consent.actorId ||
        consent.actorId !== v.lastActorId ||
        (principal.kind === 'resident' ? consent.actorId !== principal.id : !consent.decisionId)
      )
        throw Error('custody-consent-source-required');
    } else if (v.status === 'withdrawn') {
      if (
        added.length ||
        (!v.withdrawalAuthority &&
          v.lastActorId !== old.nextCarrierId &&
          (v.lastActorId !== old.createdBy || !!old.createdByCollectiveId) &&
          !roles.some(
            (role) =>
              old.consents[role]?.actorId === v.lastActorId &&
              (!s.collectiveGrantsVersion || old.principals[role].kind === 'resident'),
          ))
      )
        throw Error('custody-withdrawal-source-required');
    } else if (
      v.status !== 'accepted' ||
      v.lastActorId !== v.nextCarrierId ||
      added.length ||
      roles.some((role) => !(role === 'previous-carrier' && v.departure) && !v.consents[role])
    )
      throw Error('custody-acceptance-consents-required');
  }
  return {
    ...s,
    proposals: { ...s.proposals, [v.id]: structuredClone(v) },
    holders:
      v.status === 'accepted'
        ? {
            ...s.holders,
            [f.id]: {
              carrierId: v.nextCarrierId,
              ...(v.vehicleId ? { vehicleId: v.vehicleId } : {}),
              handoffId: v.id,
            },
          }
        : s.holders,
  };
}

function withoutWithdrawalAuthority(v: FreightCustodyHandoff) {
  const { withdrawalAuthority, ...rest } = v;
  void withdrawalAuthority;
  return rest;
}

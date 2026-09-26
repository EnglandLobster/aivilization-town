export const RESIDENT_HOUSEHOLD_POLICY = {
  version: 'resident-households-v1',
  maxText: 8000,
} as const;
export type HouseholdLink = {
  id: string;
  proposerId: string;
  partnerId: string;
  kind: 'family' | 'guardianship' | 'cohabitation';
  terms: string;
  revision: number;
  status: 'proposed' | 'active' | 'rejected' | 'ended';
  at: number;
};
export type HouseholdState = {
  version: 'resident-households-v1';
  links: Readonly<Record<string, HouseholdLink>>;
};
export type HouseholdEvent = { type: 'HouseholdLinkChanged'; link: HouseholdLink };
export type HouseholdCommand =
  | { type: 'propose'; id: string; partnerId: string; kind: HouseholdLink['kind']; terms: string }
  | { type: 'accept' | 'reject' | 'end'; id: string; expectedRevision: number };
export function emptyHouseholdState(): HouseholdState {
  return { version: 'resident-households-v1', links: {} };
}
export function decideHousehold(
  s: HouseholdState,
  a: string,
  at: number,
  c: HouseholdCommand,
  p: { exists: (id: string) => boolean; cohabiting: (a: string, b: string) => boolean },
): { accepted: true; events: readonly HouseholdEvent[] } | { accepted: false; reason: string } {
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!p.exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (c.type === 'propose') {
    if (
      !['family', 'guardianship', 'cohabitation'].includes(c.kind) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.id) ||
      Object.hasOwn(s.links, c.id) ||
      !p.exists(c.partnerId) ||
      a === c.partnerId ||
      !c.terms.trim() ||
      c.terms.length > RESIDENT_HOUSEHOLD_POLICY.maxText
    )
      return no('invalid-household-proposal');
    return {
      accepted: true,
      events: [
        {
          type: 'HouseholdLinkChanged',
          link: {
            id: c.id,
            proposerId: a,
            partnerId: c.partnerId,
            kind: c.kind,
            terms: c.terms,
            revision: 1,
            status: 'proposed',
            at,
          },
        },
      ],
    };
  }
  const l = s.links[c.id];
  if (!l || ![l.proposerId, l.partnerId].includes(a)) return no('link-not-found');
  if (l.revision !== c.expectedRevision) return no('revision-conflict');
  if (c.type === 'end') {
    if (l.status !== 'active') return no('active-link-required');
  } else {
    if (l.partnerId !== a || l.status !== 'proposed')
      return no('independent-partner-consent-required');
    if (
      c.type === 'accept' &&
      l.kind === 'cohabitation' &&
      !p.cohabiting(l.proposerId, l.partnerId)
    )
      return no('real-shared-residence-required');
  }
  return {
    accepted: true,
    events: [
      {
        type: 'HouseholdLinkChanged',
        link: {
          ...l,
          revision: l.revision + 1,
          status: c.type === 'accept' ? 'active' : c.type === 'reject' ? 'rejected' : 'ended',
        },
      },
    ],
  };
}
export function applyHouseholdEvent(s: HouseholdState, e: HouseholdEvent): HouseholdState {
  if (e.link.revision !== (s.links[e.link.id]?.revision ?? 0) + 1)
    throw new Error('household-revision-gap');
  return { ...s, links: { ...s.links, [e.link.id]: e.link } };
}

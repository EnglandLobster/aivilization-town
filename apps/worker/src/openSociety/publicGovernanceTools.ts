import { premisesAuthorization } from './premisesTools';
import { principalCollectiveAuthority } from './principalCollectiveAuthority';
import { publicHousingQuery } from './publicHousingQuery';
import { publicEmploymentQuery } from './publicEmploymentQuery';
import {
  assertPublicAction,
  type PublicAction,
  type PublicCommand,
} from '@aivilization/governance';
import { residentPublicGovernanceCommand, type WorldCommandPolicies } from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { stringArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { controllerAvailable } from './resourceControlAccess';

export function executePublicGovernanceTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  policies: WorldCommandPolicies,
  actorId: string,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): ToolExecution {
  const state = s.world.publicGovernance;
  if (!state) throw new ToolRefusal('public-governance-not-enabled');
  const a = state.authority,
    at = s.world.clock.now,
    result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'governance.housing') return result(publicHousingQuery(s.world, args));
  if (name === 'governance.employment')
    return result(publicEmploymentQuery(s.world, actorId, args));
  if (name === 'governance.status')
    return result({
      policy: a.policy,
      grant: a.grant,
      procedure: a.procedure,
      procedureRevision: a.procedureRevision,
      institutionLimits: state.institutionPolicy,
      procurement: a.grant.procurement
        ? {
            policy: a.grant.procurement,
            treasuryBalance: s.world.treasury ?? 0,
            minimumTreasuryReserve: s.world.governance?.publicBudget?.minimumTreasuryReserve ?? 0,
            contractWith: 'town engagements read',
            ledgerWith: 'town engagements ledger',
            fundingAction: {
              kind: 'fund-service',
              engagementId: 'exact-id',
              expectedRevision: 'observed-revision',
              maximumCharge: 'observed-maximumCharge',
            },
            abstractBudget: 'disabled',
          }
        : null,
      goodsProcurement: a.grant.goodsProcurement
        ? {
            policy: a.grant.goodsProcurement,
            contractWith: 'town trades read',
            ledgerWith: 'town trades ledger',
            fundingAction: {
              kind: 'fund-goods',
              orderId: 'exact-id',
              expectedRevision: 'observed-revision',
              amount: 'observed-amount',
            },
            ownership:
              'Named buyer receives the goods; treasury funding does not create public ownership.',
          }
        : null,
      housing: a.grant.housing
        ? { grant: a.grant.housing, rulesWith: 'town governance housing' }
        : null,
      employment: a.grant.employment
        ? { grant: a.grant.employment, rulesWith: 'town governance employment' }
        : null,
      currentPolicyRevision: s.world.governance?.revision ?? 0,
      fiscalWith: 'town city observe --view fiscal',
      enacted: {
        tax: policies.tax ?? null,
        publicBudget: policies.publicBudget ?? null,
        subsidy: policies.safetyNetSubsidy ?? null,
      },
      notes: [
        'Only an explicitly granted initial institution; not resident-created authority.',
        'Procedure changes use the current rules and invalidate unused authority under superseded procedures.',
        'Tax and other effects preserve existing economic rules. Public approval does not invent money or change physical laws.',
      ],
    });
  if (name === 'governance.list')
    return result(
      pageItems(
        Object.values(a.proposals)
          .sort((l, r) => r.createdAt - l.createdAt || l.id.localeCompare(r.id, 'en'))
          .map((p) => ({
            id: p.id,
            authorId: p.authorId,
            revision: p.revision,
            status: p.status,
            kind: p.action.kind,
            closesAt: p.closesAt,
            expiresAt: p.expiresAt,
            executionExpired: at >= p.expiresAt,
            procedureSuperseded: p.procedureRevision !== a.procedureRevision,
            readWith: 'town governance read',
          })),
        args,
      ),
    );
  const id = stringArg(args, 'id');
  if (['governance.read', 'governance.votes', 'governance.objections'].includes(name)) {
    const p = a.proposals[id];
    if (!Object.hasOwn(a.proposals, id) || !p) throw new ToolRefusal('public-proposal-not-found');
    if (name === 'governance.votes')
      return result(
        pageItems(
          Object.values(p.votes).map((v) => ({
            ...v,
            id: `${p.id}:${v.actorId}`,
            revision: p.voteChanges[v.actorId],
            authorId: v.actorId,
            provenance: 'personal-ballot',
          })),
          args,
        ),
      );
    if (name === 'governance.objections')
      return result(
        pageItems(
          Object.values(a.objections)
            .filter((o) => o.proposalId === id)
            .map((o) => ({ ...o, authorId: o.actorId, provenance: 'attributed-objection' })),
          args,
        ),
      );
    const { votes, voteChanges, ...original } = p;
    void voteChanges;
    return result({
      ...original,
      voteCount: Object.keys(votes).length,
      executionExpired: at >= p.expiresAt,
      procedureSuperseded: p.procedureRevision !== a.procedureRevision,
      votesWith: 'town governance votes',
      objectionsWith: 'town governance objections',
    });
  }
  let command: PublicCommand | { type: 'execute'; id: string; expectedRevision: number };
  if (name === 'governance.propose') {
    // Validated envelope boundary: assertPublicAction checks every nested field, shape and grant.
    const action = args.action as PublicAction;
    try {
      assertPublicAction(action, a.grant);
    } catch {
      throw new ToolRefusal('public-action-outside-grant-or-invalid');
    }
    command = {
      type: 'propose',
      id,
      text: stringArg(args, 'text'),
      action,
      closesAt: numberArg(args, 'closesAt'),
      expectedProcedureRevision: numberArg(args, 'expectedProcedureRevision'),
    };
  } else if (name === 'governance.object')
    command = {
      type: 'object',
      id,
      proposalId: stringArg(args, 'proposalId'),
      text: stringArg(args, 'text'),
    };
  else {
    const expectedRevision = numberArg(args, 'expectedRevision');
    if (name === 'governance.vote') {
      const choice = stringArg(args, 'choice');
      if (choice !== 'yes' && choice !== 'no' && choice !== 'abstain')
        throw new ToolRefusal('invalid-public-vote');
      command = { type: 'vote', id, expectedRevision, choice };
    } else if (name === 'governance.close') command = { type: 'close', id, expectedRevision };
    else if (name === 'governance.withdraw') command = { type: 'withdraw', id, expectedRevision };
    else if (name === 'governance.execute') command = { type: 'execute', id, expectedRevision };
    else throw new ToolRefusal('unknown-public-capability');
  }
  const d = residentPublicGovernanceCommand({
    projection: s.world,
    collective: principalCollectiveAuthority(s),
    premisesAuthorization: premisesAuthorization(s, () => undefined),
    controllerAvailable: (c) => controllerAvailable(s, c),
    actorId,
    command,
    requestId: `public-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      id,
      events: d.events.map((e) => ({ id: e.id, type: e.type })),
      readWith: 'town governance read',
      policyWith: 'town governance status',
    },
    effects: { worldEvents: d.events },
  };
}

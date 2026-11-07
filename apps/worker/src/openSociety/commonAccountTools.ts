import {
  parseCommonAccountOperation,
  type CommonAccount,
  type CommonAccountResourceOperation,
} from '@aivilization/economy';
import { type CollectiveResourceAction } from '@aivilization/collaboration';
import {
  residentCommonAccountEvent,
  type CommonAccountAuthorizationPort,
  type ResidentCommonAccountCommand,
} from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { ToolRefusal, stringArg, numberArg, pageItems } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
const member = (s: OpenSocietyState, cid: string, actor: string) =>
  s.collectives?.charters[cid]?.status === 'active' &&
  s.collectives.charters[cid].members.includes(actor) === true;
const metadata = (a: CommonAccount) => ({
  id: a.id,
  collectiveId: a.collectiveId,
  title: a.title,
  status: a.status,
  revision: a.revision,
  controlVersion: a.controlVersion,
});
const fundingOperation = (
  s: OpenSocietyState,
  collectiveId: string,
  action: CollectiveResourceAction,
): CommonAccountResourceOperation => {
  const funds = s.world.commonAccounts;
  if (!funds) throw new ToolRefusal('common-accounts-not-enabled');
  const op = parseCommonAccountOperation(
    action.capability,
    action.resourceId,
    action.arguments,
    funds.policy,
  );
  if (!op) throw new ToolRefusal('unsupported-or-invalid-common-account-action');
  const a = funds.accounts[op.id];
  if (!a || a.collectiveId !== collectiveId)
    throw new ToolRefusal('collective-does-not-control-account');
  if (a.status === 'closed') throw new ToolRefusal('common-account-closed');
  if (a.controlVersion !== op.controlVersion)
    throw new ToolRefusal('common-account-control-version-conflict');
  return op;
};
export function validateCommonAccountResourceAction(
  state: OpenSocietyState,
  collectiveId: string,
  action: CollectiveResourceAction,
): string | undefined {
  try {
    fundingOperation(state, collectiveId, action);
    return undefined;
  } catch (e) {
    if (e instanceof ToolRefusal) return e.reason;
    throw e;
  }
}
function settle(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  command: ResidentCommonAccountCommand,
  requestId: string,
  authorization: CommonAccountAuthorizationPort,
): ToolExecution {
  const d = residentCommonAccountEvent({
    projection: state.world,
    actorId,
    command,
    authorization,
    requestId: `funds-${digest([actorId, requestId]).slice(0, 32)}`,
    receiptId: `funds-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: manifest.simulationId,
    nextSequence: state.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  const receipts = d.events.flatMap((e) =>
    e.type === 'ResidentCommonAccountsCommitted'
      ? e.payload.events.flatMap((v) =>
          v.type === 'CommonAccountReceiptRecorded' ? [v.receipt] : [],
        )
      : [],
  );
  return {
    data: { receipts },
    effects: { worldEvents: d.events, experiences: worldExperiences(state, d.events, actorId) },
  };
}
function membershipPort(state: OpenSocietyState): CommonAccountAuthorizationPort {
  return {
    isActiveMember: (cid, actor) => member(state, cid, actor),
    authorize: () => ({ accepted: false, reason: 'collective-decision-required' }),
    // World adds authoritative service refund/revenue obligations. Other external consumers
    // must register their own obligation references before accepting commitments.
    unresolvedObligations: () => false,
  };
}
export function executeApprovedCommonAccount(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  collectiveId: string,
  id: string,
  action: CollectiveResourceAction,
  requestId: string,
): ToolExecution {
  if (!state.collectives) throw new ToolRefusal('collectives-not-enabled');
  const operation = fundingOperation(state, collectiveId, action);
  const decision = state.collectives.decisions[id]!;
  const result = settle(state, manifest, actorId, operation, requestId, {
    ...membershipPort(state),
    authorize: (command, controllerId) =>
      controllerId === collectiveId && digest(command) === digest(operation)
        ? {
            accepted: true,
            authority: {
              collectiveId,
              decisionId: id,
              decisionRevision: decision.revision,
              charterVersion: decision.charterVersion,
            },
          }
        : { accepted: false, reason: 'collective-resource-payload-mismatch' },
  });
  return result;
}
export function executeCommonAccountTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.world.commonAccounts;
  if (!s) throw new ToolRefusal('common-accounts-not-enabled');
  const id = stringArg(args, 'id'),
    result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'funds.list')
    return result(
      pageItems(
        Object.values(s.accounts)
          .filter((a) => member(state, a.collectiveId, actorId))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((a) => ({
            ...metadata(a),
            balance: a.balance,
            readWith: `town funds read --id ${a.id}`,
          })),
        args,
      ),
    );
  if (name === 'funds.read' || name === 'funds.ledger') {
    const a = Object.hasOwn(s.accounts, id) ? s.accounts[id] : undefined;
    if (!a) throw new ToolRefusal('common-account-not-found');
    const authorized = member(state, a.collectiveId, actorId);
    if (name === 'funds.read')
      return result({
        ...metadata(a),
        ...(authorized
          ? { balance: a.balance, ledgerWith: `town funds ledger --id ${id}` }
          : { balanceVisible: false }),
      });
    if (!authorized) throw new ToolRefusal('common-account-ledger-not-authorized');
    return result(
      pageItems(
        Object.values(s.receipts)
          .filter((r) => r.accountIds.includes(id))
          .sort((a, b) => (a.accountRevisions[id] ?? 0) - (b.accountRevisions[id] ?? 0)),
        args,
      ),
    );
  }
  let command: ResidentCommonAccountCommand;
  if (name === 'funds.open')
    command = {
      type: 'open',
      id,
      collectiveId: stringArg(args, 'collectiveId'),
      title: stringArg(args, 'title'),
    };
  else if (name === 'funds.contribute')
    command = {
      type: 'contribute',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
      amount: numberArg(args, 'amount'),
      note: stringArg(args, 'note'),
    };
  else throw new ToolRefusal('unknown-common-account-command');
  return settle(state, manifest, actorId, command, requestId, membershipPort(state));
}

import {
  assertCapitalAuthority,
  capitalAccountKey,
  capitalFactsEqual,
  enterpriseController,
  type CapitalAccount,
  type CapitalAuthority,
  type EnterpriseState,
  type EnterpriseCapitalEvent,
} from '@aivilization/enterprise';
import {
  sameController,
  type ControlAuthorizationPort,
  type Controller,
} from '@aivilization/authority';
import type { CapitalInvocation, CapitalEnterpriseCommand } from './capitalModel';
import type { WorldProjection } from './projection';
import { residentFinancialAccount } from './residentFinancialAccounts';

export function resolveCapitalInvocation(
  w: WorldProjection,
  e: EnterpriseState,
  actorId: string,
  command: CapitalEnterpriseCommand,
  authorize: ControlAuthorizationPort,
): CapitalInvocation | undefined {
  const proof = (controller: Controller): CapitalAuthority | undefined => {
    const a = authorize(controller);
    if (!a || a.actorId !== actorId) return undefined;
    const p = { actorId, controller, ...(a.decisionId ? { decisionId: a.decisionId } : {}) };
    assertCapitalAuthority(p);
    return p;
  };
  const holder = (account: CapitalAccount): CapitalInvocation | undefined => {
    const a = residentFinancialAccount(w, account),
      p = a && proof(a.controller);
    return p ? { kind: 'holder', account, proof: p } : undefined;
  };
  const manager = (): CapitalInvocation | undefined => {
    const p = proof(enterpriseController(e));
    return p ? { kind: 'management', proof: p } : undefined;
  };
  if (command.type === 'initialize' || command.type === 'authorize' || command.type === 'close')
    return manager();
  if (command.type === 'accept') return holder(command.account);
  if (command.type === 'propose')
    return (
      manager() ?? e.capital?.positions.map((p) => holder(p.account)).find((p) => p !== undefined)
    );
  const a = e.capital?.agreements[command.id];
  if (!a) return undefined;
  if (command.type === 'cancel') {
    const p = proof(a.proposerAuthority.controller);
    if (p) return { kind: 'proposer', proof: p };
  }
  return a.participants.map(holder).find((p) => p !== undefined);
}
/** Recorded delegation must bind the current account/controller; outer runtime proves exact collective decision consumption. */
export function assertCapitalInvocation(
  w: WorldProjection,
  e: EnterpriseState,
  actorId: string,
  invocation: CapitalInvocation,
  event: EnterpriseCapitalEvent,
) {
  if (invocation.kind === 'automatic') {
    if (
      actorId !== 'system' ||
      (event.type !== 'EnterpriseCapitalDividendPaid' &&
        (event.type !== 'EnterpriseCapitalAgreementCommitted' ||
          event.event.operation !== 'cancel' ||
          event.event.actorId !== 'system'))
    )
      throw Error('invalid-automatic-capital-effect');
    return;
  }
  if (!w.agents[actorId] || actorId === 'system') throw Error('capital-actor-unavailable');
  const operation =
    event.type === 'EnterpriseCapitalClosed'
      ? 'close'
      : event.type === 'EnterpriseCapitalEnabled'
        ? 'initialize'
        : event.type === 'EnterpriseCapitalAgreementCommitted'
          ? event.event.operation
          : 'dividend';
  if (invocation.kind === 'proposer') {
    assertCapitalAuthority(invocation.proof);
    if (
      event.type !== 'EnterpriseCapitalAgreementCommitted' ||
      operation !== 'cancel' ||
      invocation.proof.actorId !== actorId ||
      !sameController(
        invocation.proof.controller,
        e.capital!.agreements[event.event.agreement.id]!.proposerAuthority.controller,
      )
    )
      throw Error('capital-withdrawal-authority-mismatch');
    return;
  }
  const p = invocation.proof;
  assertCapitalAuthority(p);
  if (
    operation === 'propose' &&
    event.type === 'EnterpriseCapitalAgreementCommitted' &&
    !capitalFactsEqual(p, event.event.agreement.proposerAuthority)
  )
    throw Error('capital-proposer-invocation-mismatch');
  if (p.actorId !== actorId) throw Error('capital-actor-source-mismatch');
  if (invocation.kind === 'management') {
    if (
      !['initialize', 'propose', 'authorize', 'close'].includes(operation) ||
      !sameController(p.controller, enterpriseController(e))
    )
      throw Error('capital-management-invocation-mismatch');
    if (
      (event.type === 'EnterpriseCapitalEnabled' || event.type === 'EnterpriseCapitalClosed') &&
      !capitalFactsEqual(p, {
        actorId: event.authority.actorId,
        controller: event.authority.controller,
        ...(event.authority.decisionId ? { decisionId: event.authority.decisionId } : {}),
      })
    )
      throw Error('capital-initial-authority-mismatch');
    if (
      event.type === 'EnterpriseCapitalAgreementCommitted' &&
      operation === 'authorize' &&
      !capitalFactsEqual(p, event.event.agreement.management?.authority)
    )
      throw Error('capital-company-consent-mismatch');
    return;
  }
  const account = residentFinancialAccount(w, invocation.account);
  if (
    !account ||
    !sameController(account.controller, p.controller) ||
    !['propose', 'accept', 'execute', 'cancel'].includes(operation) ||
    event.type !== 'EnterpriseCapitalAgreementCommitted'
  )
    throw Error('capital-account-invocation-mismatch');
  const eligible =
    operation === 'propose'
      ? e.capital?.positions.map((p) => p.account)
      : event.event.agreement.participants;
  if (!eligible?.some((a) => capitalAccountKey(a) === capitalAccountKey(invocation.account)))
    throw Error('capital-holder-required');
  if (
    operation === 'accept' &&
    !capitalFactsEqual(
      p,
      event.event.agreement.consents[capitalAccountKey(invocation.account)]?.authority,
    )
  )
    throw Error('capital-account-consent-mismatch');
}

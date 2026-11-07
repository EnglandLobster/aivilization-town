import {
  decodePeriodicCommand,
  assertPeriodicTerms,
  periodicUnpaidMicros,
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  type PeriodicObligation,
  type PeriodicCommand,
} from '@aivilization/commerce';
import { worldPeriodicRequest, worldPeriodicAccount } from '@aivilization/world';
import { samePrincipal } from '@aivilization/authority';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { principalVisibleTo } from './resourceControlAccess';
import { pageItems, stringArg, ToolRefusal } from './arguments';
const visible = (s: OpenSocietyState, c: PeriodicObligation, actorId: string) =>
  principalVisibleTo(s, c.payerPrincipal, actorId) ||
  principalVisibleTo(s, c.revenuePrincipal, actorId);
/** Current subject access, not original author backdoors. No actual private balance is returned in templates. */
export function executePeriodicTool(
  s: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Record<string, unknown>,
): ToolExecution {
  const state = s.world.periodicObligations;
  if (!state) throw new ToolRefusal('periodic-obligations-not-enabled');
  if (name === 'obligations.prepare') {
    const c = decodePeriodicCommand(args.command);
    if (c.type !== 'offer') throw new ToolRefusal('periodic-offer-terms-required');
    assertPeriodicTerms(c, s.world.clock.now);
    const payer = worldPeriodicAccount(s.world, c.payer),
      revenue = worldPeriodicAccount(s.world, c.revenue);
    if (!payer || !principalVisibleTo(s, payer.principal, actorId))
      throw new ToolRefusal('periodic-current-payer-access-required');
    if (
      payer.status !== 'open' ||
      !revenue ||
      revenue.status !== 'open' ||
      samePrincipal(payer.principal, revenue.principal)
    )
      throw new ToolRefusal('periodic-open-independent-accounts-required');
    return {
      data: {
        kind: 'periodic-obligation',
        policy: state.policy,
        request: worldPeriodicRequest(s.world, c),
        operateWith: 'town principals operate --request <whole exact request>',
        independentWith:
          'collectives propose/vote/decide/execute or governance propose/vote/close/execute; approve the whole finite total, not one installment',
      },
      effects: {},
    };
  }
  if (name === 'obligations.list') {
    const items = Object.values(state.contracts)
      .filter((c) => visible(s, c, actorId))
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        title: c.title,
        revision: c.revision,
        status: c.status,
        at: c.at,
        payer: c.payer,
        revenue: c.revenue,
        amount: c.amount,
        processedPeriods: c.cursor,
        remainingFuturePeriods: c.status === 'active' ? c.periods - c.cursor : 0,
        unpaidAmount: periodicUnpaidMicros(c) / POLICY.moneyScale,
        readWith: `town obligations read --id ${c.id}`,
      }));
    return {
      data: pageItems(items, args, Math.min(30, manifest.policy.maxQueryItems)),
      effects: {},
    };
  }
  if (name !== 'obligations.read') throw new ToolRefusal('unknown-periodic-query');
  const c = state.contracts[stringArg(args, 'id')];
  if (!c || !visible(s, c, actorId)) throw new ToolRefusal('periodic-obligation-not-readable');
  const { installments, ...agreement } = c;
  const operations: Record<string, unknown> = {};
  const add = (command: PeriodicCommand) => {
    operations[command.type] = worldPeriodicRequest(s.world, command);
  };
  if (c.status === 'offered')
    for (const type of ['accept', 'withdraw', 'decline'] as const)
      add({ type, id: c.id, expectedRevision: c.revision });
  if (c.status === 'active') add({ type: 'terminate', id: c.id, expectedRevision: c.revision });
  const periods = pageItems(
    Object.values(installments).sort((a, b) => a.period - b.period),
    args,
    Math.min(30, manifest.policy.maxQueryItems),
  );
  return {
    data: {
      kind: 'periodic-obligation',
      agreement,
      policy: state.policy,
      operations,
      installments: {
        ...periods,
        items: periods.items.map((i) => ({
          ...i,
          ...(i.status === 'unpaid'
            ? {
                operations: Object.fromEntries(
                  (['settle', 'waive'] as const).map((type) => [
                    type,
                    worldPeriodicRequest(s.world, {
                      type,
                      id: c.id,
                      expectedRevision: c.revision,
                      period: i.period,
                    }),
                  ]),
                ),
              }
            : {}),
        })),
      },
      unpaidAmount: periodicUnpaidMicros(c) / POLICY.moneyScale,
      remainingFutureAmount: c.status === 'active' ? (c.periods - c.cursor) * c.amount : 0,
      operateWith: 'town principals operate --request <whole exact request>',
      limitation:
        'Future termination preserves old unpaid claims. Payment does not prove housing, membership, service, education or satisfaction. Each actual party independently controls its own account; programs cannot create these obligations.',
    },
    effects: {},
  };
}

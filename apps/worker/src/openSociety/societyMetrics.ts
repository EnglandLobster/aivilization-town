import { accountingTransactions, createMoneyTracer, RETURNED } from './moneyTrace';
import { applyOpenSocietyCommit, initialOpenSocietyState } from './state';
import type { OpenSocietyCommit, OpenSocietyManifest, OpenSocietyState } from './types';

/**
 * Read-only emergence measurement over committed journal facts.
 *
 * It answers "is a society forming?" with structural numbers rather than counts of
 * capabilities used: who depends on whom (money, goods, labor), who keeps talking to whom,
 * whether residents specialize, and how much of resident income is exogenous. It never
 * reads model narrative, never scores residents, and never feeds back into prompts.
 *
 * v2: money is reconciled with balances. Accounting transactions anywhere in an event are traced
 * through intermediate accounts (see moneyTrace), so escrowed order payments count as coming from
 * the buyer and a refund of one's own money is "returned", not income; the state is replayed so
 * every resident's attributed inflow minus outflow equals their actual balance change, with
 * anything not yet attributed booked as `unclassified:<capability>`. v1 labeled every resident
 * credit in a commerce transaction "fromResidents", whatever the counterparty.
 */
export const SOCIETY_METRICS_VERSION = 'society-metrics-v2';

type Bag = Record<string, number>;
type Pair = { interactions: number; days: Set<number>; channels: Bag; directions: Set<string> };

const STRUCTURE_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  organizations: [
    'world.found_enterprise',
    'world.join_enterprise',
    'collectives.create',
    'collectives.join',
    'funds.open',
    'programs.publish',
    'registers.create',
  ],
  agreements: [
    'proposals.create',
    'capital.propose',
    'households.propose',
    'obligations.prepare',
    'orders.create',
    'orders.accept',
    'trades.accept',
    'engagements.accept',
    'leases.accept',
    'permits.accept',
  ],
  markets: ['offers.publish', 'services.publish'],
  publicLife: [
    'governance.propose',
    'governance.vote',
    'governance.execute',
    'spaces.create',
    'files.create',
    'groups.create',
    'groups.invite',
  ],
};

/**
 * Multi-party flows through which a society builds structure, step by step. Counting attempts,
 * successes and refusal reasons per step shows where residents actually stop, so the flows can be
 * simplified where evidence says it matters instead of by guesswork.
 */
const FUNNELS: Readonly<Record<string, readonly string[]>> = {
  hiring: [
    'world.found_enterprise',
    'world.post_job',
    'world.apply_job',
    'world.join_enterprise',
    'production.create',
    'production.start',
  ],
  collectives: [
    'collectives.create',
    'collectives.respond',
    'collectives.join',
    'collectives.propose',
    'collectives.vote',
    'collectives.decide',
    'collectives.execute',
    'funds.open',
    'funds.contribute',
  ],
  construction: [
    'sites.list',
    'construction.plan',
    'materials.reserve',
    'construction.create',
    'construction.start',
    'construction.finish',
  ],
  residentTrade: [
    'offers.publish',
    'orders.create',
    'orders.accept',
    'orders.pay',
    'orders.deliver',
    'orders.confirm',
    'payments.transfer',
  ],
};
type FunnelStep = { attempts: number; succeeded: number; refusals: Bag };

/** Channels that move money, goods or labor between residents, as opposed to talk. */
const MATERIAL_CHANNELS = ['gift', 'payment', 'order', 'goodsHandover', 'jointProduction'];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function add(bag: Bag, key: string, amount = 1) {
  bag[key] = (bag[key] ?? 0) + amount;
  if (bag[key] === 0) delete bag[key];
}
function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
function roundBag(bag: Bag): Bag {
  return Object.fromEntries(
    Object.entries(bag)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, value]) => [key, round(value)]),
  );
}

/** Request IDs the runtime gives the steps it runs from a resident's action plan. */
const PLAN_STEP_REQUEST = /^plan-[0-9a-f]{32}$/;
export function createSocietyMetrics(manifest: OpenSocietyManifest) {
  const residents = new Set(manifest.residents.map((resident) => resident.id));
  const dayMs = manifest.rhythm?.dayLengthMs ?? 86_400_000;
  let commits = 0;
  let firstAt: number | undefined;
  let lastAt = 0;
  const opportunities: Bag = {};
  const wakeReasons: Bag = {};
  // Turns handed back because the provider failed before any call are not opportunities.
  const turnReasons = new Map<string, string>();
  let requeued = 0;
  let waits = 0;
  let residentCalls = 0;
  let refusals = 0;
  const capabilities = new Set<string>();
  const callsByGroup: Bag = {};
  let cognitionUpdates = 0;
  const goalKeys = new Set<string>();
  let reminders = 0;
  const pairs = new Map<string, Pair>();
  const channels: Bag = {};
  const groupMembers = new Map<string, Set<string>>();
  const inflow: Record<string, Bag> = {};
  const outflow: Record<string, Bag> = {};
  const tracer = createMoneyTracer(residents);
  // Replayed alongside, so attribution can be checked against actual balance changes.
  // Undefined once commits stop forming a contiguous journal (hand-built inputs); attribution
  // continues, only the balance check stops.
  let state: OpenSocietyState | undefined = initialOpenSocietyState(manifest);
  const commitDelta = new Map<string, number>();
  const unattributed: Bag = {};
  const produced: Record<string, Bag> = {};
  const completedBatches = new Set<string>();
  const ordersSeen = new Set<string>();
  const ordersCompleted = new Set<string>();
  let jointBatches = 0;
  const structures: Record<string, Bag> = Object.fromEntries(
    Object.keys(STRUCTURE_CAPABILITIES).map((group) => [group, {}]),
  );
  const unclassifiedWorldEvents: Bag = {};
  // Action plans: steps the world ran for a resident between opportunities, kept apart from the
  // calls residents made themselves.
  let plansCreated = 0;
  let planSteps = 0;
  let planStepRefusals = 0;
  const planStepsByCapability: Bag = {};
  const planEndings: Bag = {};
  const planStopReasons: Bag = {};
  const funnels: Record<string, Record<string, FunnelStep>> = Object.fromEntries(
    Object.entries(FUNNELS).map(([flow, steps]) => [
      flow,
      Object.fromEntries(steps.map((step) => [step, { attempts: 0, succeeded: 0, refusals: {} }])),
    ]),
  );
  // A resident's attempt at a step, whether made in an opportunity or by their action plan.
  const funnelAttempt = (commit: OpenSocietyCommit) => {
    for (const steps of Object.values(funnels)) {
      const step = steps[commit.capability];
      if (step === undefined) continue;
      step.attempts++;
      if (commit.result.ok) step.succeeded++;
      else add(step.refusals, (commit.result.error ?? 'refused').split(':')[0]!.slice(0, 80));
    }
  };

  const money = (
    side: Record<string, Bag>,
    actorId: string | undefined,
    kind: string,
    v: number,
  ) => {
    if (actorId === undefined || !residents.has(actorId) || v === 0) return;
    add((side[actorId] ??= {}), kind, v);
    commitDelta.set(actorId, (commitDelta.get(actorId) ?? 0) + (side === inflow ? v : -v));
  };
  const interact = (a: string | undefined, b: string | undefined, channel: string, at: number) => {
    if (a === undefined || b === undefined || a === b || !residents.has(a) || !residents.has(b))
      return;
    const key = [a, b].sort().join('|');
    const pair = pairs.get(key) ?? {
      interactions: 0,
      days: new Set<number>(),
      channels: {},
      directions: new Set<string>(),
    };
    pair.interactions++;
    pair.days.add(Math.floor(at / dayMs));
    add(pair.channels, channel);
    pair.directions.add(a);
    pairs.set(key, pair);
    add(channels, channel);
  };

  const worldEvent = (raw: unknown, commitAt: number) => {
    const event = record(raw) ?? {};
    const type = str(event.type) ?? 'unknown';
    const p = record(event.payload) ?? {};
    const at = num(event.occurredAt) || commitAt;
    const transactions = accountingTransactions(p);
    for (const transaction of transactions)
      tracer.transaction(transaction, {
        inflow: (id, label, amount) => money(inflow, id, label, amount),
        outflow: (id, label, amount) => money(outflow, id, label, amount),
        link: (from, to) => interact(from, to, 'payment', at),
      });
    switch (type) {
      case 'SubsidyPaid':
        money(inflow, str(p.agentId), `subsidy:${str(p.reason) ?? 'unspecified'}`, num(p.amount));
        return;
      case 'TradeExecuted':
        if (p.side === 'sell')
          money(inflow, str(p.agentId), 'marketSales', num(p.currencyQuantity));
        else money(outflow, str(p.agentId), 'marketPurchases', num(p.currencyQuantity));
        return;
      case 'ExternalTradeExecuted': {
        const trader = str(record(p.trader)?.agentId);
        if (p.direction === 'export') money(inflow, trader, 'exports', num(p.totalCurrency));
        else money(outflow, trader, 'imports', num(p.totalCurrency));
        return;
      }
      case 'ResidentialUpkeepCharged':
        money(outflow, str(p.agentId), 'upkeep', num(p.amount));
        return;
      case 'MedicalTreatmentCharged':
        money(outflow, str(p.agentId), 'medical', num(p.amount));
        return;
      case 'TradeTaxCharged':
        money(outflow, str(p.agentId), 'tradeTax', num(p.amount));
        return;
      case 'ResourceTransferred':
        interact(str(p.sourceAgentId), str(p.targetAgentId), 'gift', at);
        return;
      case 'ResidentialTierUpgraded':
        money(outflow, str(p.agentId), 'housingUpgrade', num(p.currencyCost));
        return;
      case 'ResidentCommerceCommitted':
        // Money is traced above; the order itself names both sides of the agreement.
        for (const inner of Array.isArray(p.events) ? p.events : []) {
          const e = record(inner);
          const order = record(e?.order);
          const id = str(order?.id);
          if (e?.type !== 'OrderChanged' || id === undefined) continue;
          if (!ordersSeen.has(id)) {
            ordersSeen.add(id);
            interact(str(order?.buyerId), str(order?.sellerId), 'order', at);
          }
          if (order?.status === 'completed') ordersCompleted.add(id);
        }
        return;
      case 'ResidentMaterialsCommitted':
        for (const inner of Array.isArray(p.events) ? p.events : []) {
          const receipt = record(record(inner)?.receipt);
          for (const transfer of Array.isArray(receipt?.transfers) ? receipt.transfers : []) {
            const to = record(record(transfer)?.to);
            if (to?.kind === 'resident')
              interact(str(receipt?.actorId), str(to.id), 'goodsHandover', at);
          }
          const production = record(record(inner)?.production);
          if (production?.status !== 'completed') continue;
          const id = str(production.id);
          if (id === undefined || completedBatches.has(id)) continue;
          completedBatches.add(id);
          const listed = Array.isArray(production.workers)
            ? production.workers.flatMap((w) =>
                typeof w === 'string' && residents.has(w) ? [w] : [],
              )
            : [];
          const creator = str(production.createdBy);
          const workers =
            listed.length > 0
              ? listed
              : creator !== undefined && residents.has(creator)
                ? [creator]
                : [];
          // Specialization is about what the recipe actually makes, not the resident-chosen label.
          const product =
            Object.keys(record(record(production.recipe)?.outputs) ?? {})
              .sort()
              .join('+') || 'unknown';
          const units = num(production.completed);
          for (const worker of workers)
            add((produced[worker] ??= {}), product, units / workers.length);
          if (workers.length > 1) {
            jointBatches++;
            for (let i = 0; i < workers.length; i++)
              for (let j = i + 1; j < workers.length; j++)
                interact(workers[i], workers[j], 'jointProduction', at);
          }
        }
        return;
      default:
        // Events whose only effect on money is their accounting transactions are interpreted.
        if (!transactions.length) add(unclassifiedWorldEvents, type);
    }
  };

  return {
    add(commit: OpenSocietyCommit) {
      commits++;
      firstAt ??= commit.at;
      lastAt = Math.max(lastAt, commit.at);
      const isResident = residents.has(commit.actorId);
      if (commit.capability === 'turn.started') {
        for (const turn of commit.turns ?? []) {
          const reason = turn.reason.split(':')[0] ?? turn.reason;
          turnReasons.set(turn.id, reason);
          add(opportunities, turn.actorId);
          add(wakeReasons, reason);
        }
      } else if (commit.capability === 'turn.finished') {
        for (const turn of commit.turns ?? []) {
          if (!turn.requeued) continue;
          requeued++;
          add(opportunities, turn.actorId, -1);
          add(wakeReasons, turnReasons.get(turn.id) ?? turn.reason.split(':')[0]!, -1);
        }
      } else if (isResident && commit.capability === 'plan.progressed') {
        const plan = commit.residents?.find((r) => r.actorId === commit.actorId)?.plan;
        if (plan && plan.status !== 'active') add(planEndings, plan.status);
        if (plan?.status === 'stopped')
          add(planStopReasons, plan.lastResult?.error?.split(':')[0] ?? 'refused');
      } else if (isResident && PLAN_STEP_REQUEST.test(commit.requestId)) {
        funnelAttempt(commit);
        planSteps++;
        if (!commit.result.ok) planStepRefusals++;
        add(planStepsByCapability, commit.capability);
      } else if (isResident && !commit.capability.startsWith('turn.')) {
        funnelAttempt(commit);
        residentCalls++;
        if (commit.capability === 'schedule.plan' && commit.result.ok) plansCreated++;
        if (commit.capability === 'schedule.plan-cancel' && commit.result.ok)
          add(planEndings, 'cancelled');
        if (!commit.result.ok) refusals++;
        capabilities.add(commit.capability);
        add(callsByGroup, commit.capability.split('.')[0] ?? commit.capability);
        if (commit.capability === 'schedule.wait' && commit.result.ok) waits++;
        if (commit.capability === 'schedule.remind' && commit.result.ok) reminders++;
        if (commit.result.ok)
          for (const [group, names] of Object.entries(STRUCTURE_CAPABILITIES))
            if (names.includes(commit.capability)) add(structures[group]!, commit.capability);
      }
      for (const event of commit.cognitiveEvents ?? []) {
        const entry = record(record(event)?.entry);
        cognitionUpdates++;
        if (entry?.kind === 'goal') goalKeys.add(`${str(entry.ownerId)}:${str(entry.key)}`);
      }
      for (const event of commit.informationEvents ?? []) {
        if (event.type !== 'MessageSent') continue;
        interact(event.message.senderId, event.message.recipientId, 'directMessage', commit.at);
      }
      for (const event of commit.communicationEvents ?? []) {
        if (event.type === 'GroupChanged')
          groupMembers.set(event.group.id, new Set(event.group.members));
        if (event.type !== 'GroupMessageSent') continue;
        for (const member of groupMembers.get(event.message.groupId) ?? [])
          interact(event.message.authorId, member, 'groupMessage', commit.at);
      }
      for (const event of commit.worldEvents ?? []) worldEvent(event, commit.at);
      // Whatever moved a resident's balance and was not attributed above is booked as unclassified,
      // so inflow minus outflow always equals the actual balance change.
      const before = state;
      try {
        state = before && applyOpenSocietyCommit(before, commit);
      } catch {
        state = undefined;
      }
      if (before && state)
        for (const id of residents) {
          const real =
            (state.world.agents[id]?.balance ?? 0) - (before.world.agents[id]?.balance ?? 0);
          const residual = real - (commitDelta.get(id) ?? 0);
          if (Math.abs(residual) > 1e-6) {
            const kind = `unclassified:${commit.capability}`;
            add(
              residual > 0 ? (inflow[id] ??= {}) : (outflow[id] ??= {}),
              kind,
              Math.abs(residual),
            );
            add(unattributed, commit.capability, Math.abs(residual));
          }
        }
      commitDelta.clear();
    },
    result() {
      const totals = (side: Record<string, Bag>) => {
        const all: Bag = {};
        for (const bag of Object.values(side))
          for (const [k, v] of Object.entries(bag)) add(all, k.split(':')[0]!, v);
        return all;
      };
      const totalIn = totals(inflow);
      // A resident's own money coming back is not income.
      const inflowSum = Object.entries(totalIn)
        .filter(([kind]) => kind !== RETURNED)
        .reduce((a, [, v]) => a + v, 0);
      const pairList = [...pairs.entries()].map(([key, pair]) => ({
        pair: key.split('|'),
        interactions: pair.interactions,
        distinctDays: pair.days.size,
        reciprocal: pair.directions.size > 1,
        channels: pair.channels,
      }));
      const possiblePairs = (residents.size * (residents.size - 1)) / 2;
      const specialization = Object.entries(produced).map(([actorId, bag]) => {
        const total = Object.values(bag).reduce((a, b) => a + b, 0);
        const shares = Object.values(bag).map((v) => v / total);
        return {
          actorId,
          units: round(total),
          products: Object.keys(bag).length,
          topShare: round(Math.max(...shares)),
          herfindahl: round(shares.reduce((a, s) => a + s * s, 0)),
        };
      });
      return {
        version: SOCIETY_METRICS_VERSION,
        simulationId: manifest.simulationId,
        population: residents.size,
        commits,
        simulatedDays: round((lastAt - (firstAt ?? 0) || 0) / dayMs),
        attention: {
          opportunities: Object.values(opportunities).reduce((a, b) => a + b, 0),
          opportunitiesByResident: opportunities,
          wakeReasons,
          endedWithWait: waits,
          requeuedProviderFailures: requeued,
          plans: {
            created: plansCreated,
            stepsRun: planSteps,
            stepRefusals: planStepRefusals,
            stepsByCapability: planStepsByCapability,
            endings: planEndings,
            stopReasons: planStopReasons,
          },
        },
        agency: {
          residentCalls,
          refusalRate: residentCalls ? round(refusals / residentCalls) : 0,
          distinctCapabilities: capabilities.size,
          callsByGroup,
          cognitionUpdates,
          goalsMaintained: goalKeys.size,
          remindersSet: reminders,
        },
        social: {
          pairsInteracting: pairList.length,
          pairDensity: possiblePairs ? round(pairList.length / possiblePairs) : 0,
          reciprocalPairs: pairList.filter((p) => p.reciprocal).length,
          // A relationship, not a one-off: repeated on more than one simulated day.
          sustainedPairs: pairList.filter((p) => p.interactions >= 3 && p.distinctDays >= 2).length,
          channels,
          materialTiesPairs: pairList.filter((p) =>
            MATERIAL_CHANNELS.some((channel) => (p.channels[channel] ?? 0) > 0),
          ).length,
          pairs: pairList.sort((a, b) => b.interactions - a.interactions).slice(0, 20),
        },
        economy: {
          inflow: roundBag(totalIn),
          outflow: roundBag(totals(outflow)),
          // Share of resident income that came from other residents rather than the platform.
          interdependence: inflowSum ? round((totalIn.fromResidents ?? 0) / inflowSum) : 0,
          byResident: Object.fromEntries(
            [...residents].sort().map((id) => [
              id,
              {
                inflow: roundBag(inflow[id] ?? {}),
                outflow: roundBag(outflow[id] ?? {}),
              },
            ]),
          ),
        },
        commerce: { ordersCreated: ordersSeen.size, ordersCompleted: ordersCompleted.size },
        production: {
          completedBatches: completedBatches.size,
          jointBatches,
          distinctProducts: new Set(Object.values(produced).flatMap((bag) => Object.keys(bag)))
            .size,
          meanTopShare: specialization.length
            ? round(specialization.reduce((a, s) => a + s.topShare, 0) / specialization.length)
            : 0,
          byResident: specialization,
        },
        structures,
        // Copies, so a later add() cannot change a result already returned.
        funnels: Object.fromEntries(
          Object.entries(funnels).map(([flow, steps]) => [
            flow,
            Object.fromEntries(
              Object.entries(steps).map(([step, v]) => [
                step,
                { ...v, refusals: { ...v.refusals } },
              ]),
            ),
          ]),
        ),
        coverage: {
          note: "Counts only committed facts. Inflow minus outflow equals each resident's actual balance change; money this version cannot attribute is booked as unclassified:<capability> (totals in unattributedMoney). unclassifiedWorldEvents lists event types this version does not interpret.",
          unattributedMoney: roundBag(unattributed),
          balancesReconciled: state !== undefined,
          unclassifiedWorldEvents,
        },
      };
    },
  };
}

export type SocietyMetrics = ReturnType<ReturnType<typeof createSocietyMetrics>['result']>;

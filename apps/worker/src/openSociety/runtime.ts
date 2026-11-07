import { assertTownConsistency } from './townConsistency';
import { messageWakeAt, residentBusyUntil } from './attention';
import { plannableCapabilities, resolveActionPlanArguments } from './actionPlans';
import { advanceResidentConstructionTrade } from '@aivilization/world';
import { nextConstructionTradeBoundary } from '@aivilization/commerce';
import { nextPeriodicBoundary } from '@aivilization/world';
import { advanceResourceSales } from '@aivilization/world';
import { advanceResidentPrincipalEvidenceTrade } from '@aivilization/world';
import { nextPrincipalTradeBoundary } from '@aivilization/commerce';
import { executeResourcePrincipalTool } from './resourcePrincipalTools';
import { executeHousingOccupancyTool } from './housingOccupancyTools';
import { executeHousingChoiceTool } from './housingChoiceTools';
import { nextPremisesRightsBoundary } from '@aivilization/premises';
import {
  advanceResidentPremisesRights,
  settleResidentPremisesProvisions,
} from '@aivilization/world';
import { nextEvidenceTradeBoundary } from '@aivilization/commerce';
import { advanceResidentEvidenceTrade } from '@aivilization/world';
import { nextLogisticsBoundary } from '@aivilization/logistics';
import { advanceResidentLogistics } from '@aivilization/world';

import { nextServiceEngagementBoundary } from '@aivilization/services';
import { advanceResidentServiceEngagements } from '@aivilization/world';
import { nextConstructionBoundary, nextPremisesWearBoundary } from '@aivilization/premises';
import { registerConstructionSiteEvent } from '@aivilization/world';
import {
  executePremisesTool,
  advanceOpenPremises,
  nextOpenPremisesBoundary,
} from './premisesTools';
import { nextMaterialBoundary } from '@aivilization/materials';
import { executeMaterialTool, advanceOpenMaterials } from './materialTools';
import { executeResourceControlTool } from './resourceControlTools';
import { executeCommonAccountTool } from './commonAccountTools';
import { nextCollectiveBoundary, advanceCollectives } from '@aivilization/collaboration';
import { executeCollectiveTool } from './collectiveTools';
import { nextMobilityBoundary } from '@aivilization/mobility';
import { nextProgramBoundary, programAdvanceWithinBudget } from '@aivilization/collaboration';
import { executeCoordinationTool } from './coordinationTools';
import { executeSharedRecordTool } from './sharedRecordTools';
import { executeDuePrograms, mergeProgramEffects } from './programExecution';
import { executeRulebookTool } from './rulebook';
import {
  assertCapabilityEffects,
  validateCapabilityBoundaries,
  boundaryAvailability,
} from './capabilityBoundaries';
import { advanceResidentMobility } from '@aivilization/world';
import { experiencePeople, readingExperiences, ORIGINAL_READS } from './readingExperiences';
import type { WorldEvent } from '@aivilization/world';
import { nextResidentLeaseBoundary, advanceResidentLeases } from '@aivilization/world';
import { executeLifeTool } from './lifeTools';
import { executeCommerceTool } from './commerceTools';
import { expireProposals } from '@aivilization/collaboration';
import { executeCollaborationTool } from './collaborationTools';
import {
  validateOpenToolArguments,
  type OpenToolRequest,
  type OpenToolResult,
} from '@aivilization/agent-runtime';
import { validInformationId } from '@aivilization/information';
import { executeCommunicationTool } from './communicationTools';
import { CITY_APPS_VERSION } from '@aivilization/content';
import { prepareCityAppInstallation } from './cityApps';
import { OPEN_SOCIETY_TOOLS, OPEN_CAPABILITY_CATALOG_VERSION } from './catalog';
import { buildOpenResidentContext, observeResidentWorld } from './context';
import { readFiscalObservation } from './fiscalObservation';
import { executeCognitionTool } from './cognitionTools';
import { executeInformationTool, type ToolExecution } from './informationTools';
import { digest, OpenSocietyJournal } from './journal';
import { openWorldPolicies, serializableWorldPolicy } from './manifest';
import { executeScheduleTool } from './scheduleTools';
import { applyOpenSocietyEffects, hasExperience } from './state';
import { dispatchOpenWorldCommand, executeOpenWorldTool, worldExperiences } from './worldTools';
import { ToolRefusal, stringArg } from './arguments';
import type {
  OpenSocietyEffects,
  OpenSocietyManifest,
  ResidentRuntimeState,
  ResidentTurn,
} from './types';

export class OpenSocietyRuntime {
  readonly journal: OpenSocietyJournal;
  constructor(rootDir: string, manifest?: OpenSocietyManifest) {
    validateCapabilityBoundaries(OPEN_SOCIETY_TOOLS);
    this.journal = new OpenSocietyJournal(rootDir, manifest);
    try {
      if (
        this.manifest.canonicalPolicyContinuation &&
        this.manifest.provenance.worldPolicyAdapter !== 'canonical-policy-continuation-v1'
      )
        throw new Error('canonical-policy-adapter-provenance-mismatch');
      if (
        digest(
          serializableWorldPolicy(
            this.manifest.seed,
            this.manifest.initialWorld,
            this.manifest.rhythm,
            this.manifest.canonicalPolicyContinuation,
          ),
        ) !== digest(this.manifest.worldPolicies)
      ) {
        throw new Error('world-policy-version-mismatch');
      }
      assertTownConsistency(this.state.world, this.manifest, this.policies());
      if (
        !['resident-cognition-v1', 'resident-cognition-v2'].includes(this.manifest.cognitionVersion)
      )
        throw new Error('unsupported-cognition-version');
      if (this.manifest.provenance.cityApps !== undefined) {
        if (this.manifest.provenance.cityApps !== CITY_APPS_VERSION)
          throw new Error('unsupported-city-apps-version');
        this.installCityApps();
      }
    } catch (error) {
      this.journal.close();
      throw error;
    }
  }
  get manifest() {
    return this.journal.manifest;
  }
  get state() {
    return this.journal.state;
  }
  close() {
    this.journal.close();
  }
  registerConstructionSite(site: {
    id: string;
    parentLocationId: string;
    usableFloorArea: number;
    accessTravelMs: number;
    sourceId: string;
  }): OpenToolResult {
    const requestId = `register-site-${digest(site).slice(0, 32)}`;
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    try {
      const d = registerConstructionSiteEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
        site: {
          ...site,
          source: 'authorized-extension',
          revision: 1,
          occupiedFloorArea: 0,
          reservedFloorArea: 0,
        },
      });
      if (!d.accepted) return this.failure(d.reason);
      return this.systemCommit(
        'system',
        requestId,
        'system.register-construction-site',
        { worldEvents: d.events },
        { siteId: site.id, sourceId: site.sourceId },
      );
    } catch (e) {
      return this.failure(e instanceof Error ? e.message : 'invalid-construction-site-extension');
    }
  }
  installCityApps(): OpenToolResult {
    const requestId = `install-${CITY_APPS_VERSION}`;
    const cached = this.journal.lookup('city-services', requestId);
    if (cached !== undefined) return cached.result;
    if (this.state.cityApps !== undefined) throw new Error('city-app-upgrade-requires-migration');
    const effects = prepareCityAppInstallation(this.state, this.manifest);
    return this.journal.commit({
      actorId: 'city-services',
      requestId,
      fingerprint: digest({ version: CITY_APPS_VERSION, effects }),
      capability: 'system.install-city-apps',
      effects,
      result: {
        ok: true,
        data: { ...effects.cityApps, sourceDigest: digest(effects.informationEvents) },
        revision: this.state.revision + 1,
        simulationTime: this.state.world.clock.now,
      },
    });
  }
  context(actorId: string) {
    return buildOpenResidentContext(this.state, this.manifest, actorId, this.policies());
  }
  discover(query = '') {
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matching = OPEN_SOCIETY_TOOLS.filter((tool) =>
      words.every((word) =>
        `${tool.name} ${tool.category} ${tool.description}`.toLocaleLowerCase().includes(word),
      ),
    );
    return {
      catalogVersion: OPEN_CAPABILITY_CATALOG_VERSION,
      total: matching.length,
      tools: matching.map((tool) => ({
        ...tool,
        availability: boundaryAvailability(tool, this.state),
      })),
      note: 'Schemas describe registered contracts, including disabled adapters. Check availability.adapterEnabled; permission, policy and resource checks still occur on each call.',
    };
  }
  beginTurn(actorId: string, reason?: string): ResidentTurn {
    this.requireResident(actorId);
    const resident = this.state.residents[actorId]!;
    const previous =
      resident.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (previous?.status === 'running') return previous;
    const id = `turn-${this.state.revision + 1}-${actorId}`;
    const at = this.state.world.clock.now;
    const turn: ResidentTurn = {
      id,
      actorId,
      startedAt: at,
      reason: reason ?? resident.wakeReason,
      calls: 0,
      status: 'running',
      summary: '',
      nextWakeAt:
        at + (resident.freeActivityIntervalMs ?? this.manifest.policy.freeActivityIntervalMs),
    };
    this.systemCommit(
      actorId,
      id,
      'turn.started',
      {
        turns: [turn],
        residents: [
          {
            ...resident,
            activeTurnId: id,
            lastTurnOrdinal: this.state.revision + 1,
            wakeReason: 'turn-active',
          },
        ],
      },
      turn,
    );
    return turn;
  }
  finishTurn(
    actorId: string,
    input: {
      summary: string;
      status?: 'completed' | 'provider-error';
      sessionId?: string;
      /**
       * The provider failed before the resident made any call: keep their wake time and reason so
       * the same opportunity is retried, instead of pushing them a whole interval later. Callers
       * that pass this must back off between retries themselves.
       */
      requeue?: true;
    },
  ): ResidentTurn {
    const resident = this.state.residents[actorId];
    const turn =
      resident?.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (resident === undefined || turn === undefined) throw new ToolRefusal('no-active-turn');
    if (input.requeue && input.status === 'provider-error' && turn.calls === 0) {
      const failed: ResidentTurn = {
        ...turn,
        status: 'provider-error',
        summary: input.summary.slice(0, 4000),
        nextWakeAt: resident.nextWakeAt,
        requeued: true,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      };
      // beginTurn marked the resident `turn-active`; restore why they were woken, unless a
      // message arrived meanwhile (it keeps its own reason, as in a normal finish).
      const restored = {
        ...resident,
        wakeReason: resident.wakeReason === 'turn-active' ? turn.reason : resident.wakeReason,
      };
      this.systemCommit(
        actorId,
        `${turn.id}-finished`,
        'turn.finished',
        { turns: [failed], residents: [restored] },
        failed,
      );
      return failed;
    }
    const status =
      input.status === 'provider-error'
        ? 'provider-error'
        : turn.status === 'waiting' || turn.status === 'budget-exhausted'
          ? turn.status
          : (input.status ?? 'completed');
    const plannedWakeAt =
      turn.status === 'waiting'
        ? turn.nextWakeAt
        : Math.max(
            this.state.world.clock.now +
              (resident.freeActivityIntervalMs ?? this.manifest.policy.freeActivityIntervalMs),
            // With attention pacing, nobody is polled in the middle of their own sleep, work or
            // journey; its completion wakes them anyway.
            this.manifest.policy.messageWake?.deferDuringActivity
              ? residentBusyUntil(this.state, actorId)
              : 0,
          );
    // A message that arrived during this opportunity wakes the resident again: immediately in
    // historical manifests, or paced (never later than their own planned wake) when enabled.
    const nextWakeAt = resident.wakeReason.startsWith('message:')
      ? this.manifest.policy.messageWake
        ? Math.min(
            plannedWakeAt,
            messageWakeAt(this.state, this.manifest.policy, resident, this.state.world.clock.now),
          )
        : this.state.world.clock.now
      : plannedWakeAt;
    const next: ResidentTurn = {
      ...turn,
      status,
      summary: (input.status === 'provider-error' && turn.status === 'waiting' && turn.summary
        ? turn.summary
        : input.summary || turn.summary
      ).slice(0, 4000),
      ...(input.status === 'provider-error' &&
      turn.status === 'waiting' &&
      turn.summary &&
      input.summary
        ? { providerSummary: input.summary.slice(0, 4000) }
        : {}),
      nextWakeAt,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    };
    this.systemCommit(
      actorId,
      `${turn.id}-finished`,
      'turn.finished',
      {
        turns: [next],
        residents: [
          {
            ...resident,
            nextWakeAt,
            wakeReason: resident.wakeReason.startsWith('message:')
              ? resident.wakeReason
              : 'free-activity',
          },
        ],
      },
      next,
    );
    this.runDuePlans();
    return next;
  }
  /**
   * Carry out queued action-plan steps for every resident who is idle, not in a live opportunity
   * and not holding an unanswered paced message. Each step is an ordinary authorized call committed
   * under the resident's identity; plan progress is committed separately. Deterministic request IDs
   * make a retried run reuse the journaled results instead of acting twice.
   */
  runDuePlans(): void {
    if (!this.state.actionPlans) return;
    const ids = Object.keys(this.state.residents).sort((a, b) => a.localeCompare(b, 'en'));
    for (const actorId of ids) this.runPlan(actorId);
  }
  private runPlan(actorId: string) {
    for (let guard = 0; guard <= (this.state.actionPlans?.maxSteps ?? 0); guard++) {
      const resident = this.state.residents[actorId]!;
      const plan = resident.plan;
      const now = this.state.world.clock.now;
      if (plan?.status !== 'active') return;
      const live = resident.activeTurnId && this.state.turns[resident.activeTurnId];
      if (live && live.status === 'running') return;
      if (residentBusyUntil(this.state, actorId) > now) return;
      if (resident.wakeReason.startsWith('message:') && resident.nextWakeAt <= now) return;
      const index = plan.next;
      const step = plan.steps[index]!;
      const requestId = `plan-${digest([actorId, plan.id, plan.createdRevision, index]).slice(0, 32)}`;
      let result: OpenToolResult;
      try {
        result = this.invoke(
          actorId,
          {
            name: step.capability,
            arguments: resolveActionPlanArguments(this.state, step, now),
            requestId,
          },
          { plan: true },
        );
      } catch (error) {
        if (!(error instanceof ToolRefusal)) throw error;
        result = this.failure(error.reason);
      }
      const after = this.state.residents[actorId]!;
      const done = index + 1 >= plan.steps.length;
      const stopped = !result.ok;
      const updated = {
        ...plan,
        next: stopped ? index : index + 1,
        status: stopped
          ? ('stopped' as const)
          : done
            ? ('completed' as const)
            : ('active' as const),
        lastResult: {
          step: index,
          capability: step.capability,
          ok: result.ok,
          ...(result.error === undefined ? {} : { error: result.error }),
          at: now,
        },
      };
      const busyUntil = residentBusyUntil(this.state, actorId);
      // Finishing or failing wakes the resident once they are free; a pending paced message keeps
      // its own earlier time. Otherwise the next step waits for the current activity to end.
      const wake =
        stopped || done
          ? {
              nextWakeAt: Math.min(
                after.wakeReason.startsWith('message:') ? after.nextWakeAt : Infinity,
                Math.max(now, busyUntil),
              ),
              wakeReason: stopped ? `plan-stopped:${result.error ?? 'refused'}` : 'plan-completed',
            }
          : after.wakeReason.startsWith('message:')
            ? {}
            : { nextWakeAt: Math.max(now, busyUntil), wakeReason: 'plan-step' };
      this.systemCommit(
        actorId,
        `${requestId}-progress`,
        'plan.progressed',
        { residents: [{ ...after, ...wake, plan: updated }] },
        { planId: plan.id, step: index, ok: result.ok, status: updated.status },
      );
      if (updated.status !== 'active' || busyUntil > now) return;
    }
  }
  nextResident(eligible?: ReadonlySet<string>): string | undefined {
    return Object.values(this.state.residents)
      .filter(
        (resident) =>
          (eligible === undefined || eligible.has(resident.actorId)) &&
          resident.nextWakeAt <= this.state.world.clock.now &&
          this.state.world.agents[resident.actorId] !== undefined,
      )
      .sort(
        (a, b) => a.lastTurnOrdinal - b.lastTurnOrdinal || a.actorId.localeCompare(b.actorId),
      )[0]?.actorId;
  }
  invoke(
    actorId: string,
    request: OpenToolRequest,
    /** `plan`: a queued step of the resident's own action plan, run without an opportunity. */
    options: { readonly plan?: true } = {},
  ): OpenToolResult {
    this.requireResident(actorId);
    if (!validInformationId(request.requestId)) return this.failure('invalid-request-id');
    if (this.journal.isHistoricalRequest(request.requestId))
      return this.failure('historical-request-id');
    const fingerprint = digest({ name: request.name, arguments: request.arguments });
    const cached = this.journal.lookup(actorId, request.requestId);
    if (cached !== undefined)
      return cached.fingerprint === fingerprint
        ? cached.result
        : this.failure('request-id-conflict');
    const resident = this.state.residents[actorId]!;
    const activeTurn =
      resident.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (
      options.plan &&
      (!this.state.actionPlans ||
        !plannableCapabilities(this.state.actionPlans.version).has(request.name))
    )
      return this.failure('plan-step-not-plannable');
    const turn = options.plan ? undefined : activeTurn;
    if (!options.plan && (turn === undefined || turn.status !== 'running'))
      return this.failure('no-active-turn');
    if (turn !== undefined && turn.calls >= this.manifest.policy.maxCallsPerTurn) {
      this.systemCommit(
        actorId,
        `${turn.id}-budget`,
        'turn.budget-exhausted',
        { turns: [{ ...turn, status: 'budget-exhausted' }] },
        { status: 'budget-exhausted' },
      );
      return this.failure('turn-budget-exhausted');
    }
    let execution: ToolExecution = { data: null, effects: {} };
    let error: string | undefined;
    try {
      const definition = OPEN_SOCIETY_TOOLS.find((tool) => tool.name === request.name);
      if (definition === undefined) throw new ToolRefusal('unknown-capability');
      for (const [key, value] of Object.entries(request.arguments))
        if (
          (key === 'id' || key.endsWith('Id')) &&
          typeof value === 'string' &&
          Object.hasOwn(Object.prototype, value)
        )
          throw new ToolRefusal('reserved-record-id');
      const invalid = validateOpenToolArguments(definition, request.arguments);
      if (invalid !== undefined) throw new ToolRefusal(invalid);
      const args =
        definition.inputSchema.properties.limit === undefined
          ? request.arguments
          : {
              ...request.arguments,
              limit: Math.min(
                Number(request.arguments.limit ?? 10),
                this.manifest.policy.maxQueryItems,
              ),
            };
      if (request.name.startsWith('rules.'))
        execution = executeRulebookTool(
          this.state,
          this.manifest,
          OPEN_SOCIETY_TOOLS,
          request.name,
          args,
        );
      else if (request.name.startsWith('principals.'))
        execution = executeResourcePrincipalTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (['housing.occupancy', 'housing.leave'].includes(request.name))
        execution = executeHousingOccupancyTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (['housing.standard', 'housing.lower'].includes(request.name))
        execution = executeHousingChoiceTool(
          this.state,
          this.manifest,
          this.policies(),
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('governance.'))
        execution = executePublicGovernanceTool(
          this.state,
          this.manifest,
          this.policies(),
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        ['sites.', 'construction.', 'premises.', 'materials.'].some((prefix) =>
          request.name.startsWith(prefix),
        )
      )
        execution = executePremisesTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        request.name.startsWith('stocks.') ||
        request.name.startsWith('production.') ||
        request.name.startsWith('sources.')
      )
        execution = executeMaterialTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('resources.'))
        execution = executeResourceControlTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('funds.'))
        execution = executeCommonAccountTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('collectives.'))
        execution = executeCollectiveTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('registers.') || request.name.startsWith('records.'))
        execution = executeSharedRecordTool(
          this.state,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('programs.') || request.name.startsWith('mandates.')) {
        const program = executeCoordinationTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
        execution = program;
        error = program.error;
      } else if (request.name === 'world.observe') {
        if (args.cursor !== undefined && args.view !== 'fiscal')
          throw new ToolRefusal('cursor-only-supported-for-fiscal-observation');
        if (
          args.view === 'fiscal' &&
          ['section', 'offset', 'limit'].some((key) => request.arguments[key] !== undefined)
        )
          throw new ToolRefusal('fiscal-observation-use-cursor');
        execution = {
          data:
            args.view === 'fiscal'
              ? readFiscalObservation({
                  treasury: this.state.world.treasury,
                  revision: this.state.revision,
                  commits: {
                    length: this.journal.commitCount,
                    at: (index) => this.journal.commitAt(index + 1),
                  },
                  ...(args.cursor === undefined ? {} : { cursor: stringArg(args, 'cursor') }),
                })
              : observeResidentWorld(this.state, this.manifest, actorId, this.policies(), args),
          effects: {},
        };
      } else if (request.name.startsWith('world.')) {
        const world = executeOpenWorldTool({
          state: this.state,
          manifest: this.manifest,
          policies: this.policies(),
          actorId,
          requestId: request.requestId,
          name: request.name,
          args,
        });
        execution = world;
        error = world.error;
      } else if (request.name.startsWith('memory.') || request.name.startsWith('cognition.'))
        execution = executeCognitionTool(
          this.state,
          actorId,
          request.name,
          args,
          this.manifest.cognitionVersion,
        );
      else if (request.name === 'housing.list')
        execution = executeLifeTool(this.state, actorId, request.name, args);
      else if (
        ['offers.', 'orders.', 'payments.', 'deposits.'].some((p) => request.name.startsWith(p))
      )
        execution = executeCommerceTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('proposals.') || request.name.startsWith('commitments.'))
        execution = executeCollaborationTool(
          this.state,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        request.name.startsWith('groups.') ||
        request.name.startsWith('blocks.') ||
        request.name === 'notifications.configure' ||
        request.name === 'notifications.settings'
      )
        execution = executeCommunicationTool(
          this.state,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('schedule.'))
        execution = executeScheduleTool(this.state, actorId, request.name, args);
      else
        execution = executeInformationTool({
          state: this.state,
          manifest: this.manifest,
          actorId,
          requestId: request.requestId,
          name: request.name,
          args,
        });
      assertCapabilityEffects(definition, execution.effects);
      if (execution.effects.worldEvents?.length) {
        const after = applyOpenSocietyEffects(this.state, execution.effects),
          expired = advanceResourceSales({
            projection: after.world,
            simulationId: this.manifest.simulationId,
            requestId: `resource-sales-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
            nextSequence: after.worldSequence + 1,
          });
        if (expired.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...expired],
            },
          };
      }

      if (execution.effects.worldEvents?.length) {
        const next = applyOpenSocietyEffects(this.state, execution.effects);
        const completed = advanceResidentServiceEngagements({
          projection: next.world,
          simulationId: this.manifest.simulationId,
          requestId: `service-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
          nextSequence: next.worldSequence + 1,
        });
        if (completed.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...completed],
            },
          };
      }
      if (execution.effects.worldEvents?.length) {
        const after = applyOpenSocietyEffects(this.state, execution.effects);
        const completedTrades = advanceResidentEvidenceTrade({
          projection: after.world,
          simulationId: this.manifest.simulationId,
          requestId: `trade-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
          nextSequence: after.worldSequence + 1,
        });
        if (completedTrades.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...completedTrades],
              experiences: [
                ...(execution.effects.experiences ?? []),
                ...worldExperiences(after, completedTrades),
              ],
            },
          };
      }
      if (execution.effects.worldEvents?.length) {
        const after = applyOpenSocietyEffects(this.state, execution.effects),
          completed = advanceResidentPrincipalEvidenceTrade({
            projection: after.world,
            simulationId: this.manifest.simulationId,
            requestId: `principal-trade-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
            nextSequence: after.worldSequence + 1,
          });
        if (completed.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...completed],
              experiences: [
                ...(execution.effects.experiences ?? []),
                ...worldExperiences(after, completed),
              ],
            },
          };
      }
      assertCapabilityEffects(definition, execution.effects);
    } catch (caught) {
      if (!(caught instanceof ToolRefusal)) throw caught;
      error = caught.reason;
    }
    // A hidden/truncated original must not be marked read or enter personal memory.
    if (
      ORIGINAL_READS.has(request.name) &&
      JSON.stringify(execution.data).length > this.manifest.policy.maxResultChars
    ) {
      execution = {
        data: { instruction: 'Reduce --limit; no originals were marked read.' },
        effects: {},
      };
      error = 'read-result-too-large';
    }
    const changedTurn =
      turn === undefined
        ? undefined
        : (execution.effects.turns?.find((entry) => entry.id === turn.id) ?? turn);
    const automaticExperience = this.toolExperience(actorId, request, execution, error);
    const effects = {
      ...execution.effects,
      experiences: [
        ...(execution.effects.experiences ?? []),
        ...(execution.effects.worldEvents && !request.name.startsWith('world.')
          ? worldExperiences(this.state, execution.effects.worldEvents).filter(
              (e) => !execution.effects.experiences?.some((existing) => existing.id === e.id),
            )
          : []),
        ...automaticExperience,
      ],
      ...(turn === undefined || changedTurn === undefined
        ? execution.effects.turns
          ? { turns: execution.effects.turns }
          : {}
        : {
            turns: [
              ...(execution.effects.turns ?? []).filter((entry) => entry.id !== turn.id),
              { ...changedTurn, calls: turn.calls + 1 },
            ],
          }),
    };
    const after = applyOpenSocietyEffects(this.state, effects);
    let data = execution.data;
    if (JSON.stringify(data).length > this.manifest.policy.maxResultChars) {
      data = {
        truncated: true,
        instruction: 'Result exceeds the configured budget. Reduce limit or read one record.',
        originalCharacters: JSON.stringify(data).length,
      };
    }
    const result: OpenToolResult = {
      ok: error === undefined,
      data,
      ...(error === undefined ? {} : { error }),
      revision: this.state.revision + 1,
      simulationTime: after.world.clock.now,
    };
    return this.journal.commit({
      actorId,
      requestId: request.requestId,
      fingerprint,
      capability: request.name,
      result,
      effects,
    });
  }
  advanceTime(deltaMs: number, requestId: string): OpenToolResult {
    if (this.journal.isHistoricalRequest(requestId)) return this.failure('historical-request-id');
    if (
      !Number.isSafeInteger(deltaMs) ||
      deltaMs < 1 ||
      deltaMs > 86_400_000 ||
      !validInformationId(requestId)
    )
      return this.failure('invalid-time-advance');
    const cached = this.journal.lookup('system', requestId);
    const fingerprint = digest({ deltaMs });
    if (cached !== undefined)
      return cached.fingerprint === fingerprint
        ? cached.result
        : this.failure('request-id-conflict');
    const events: WorldEvent[] = [];
    let working = this.state;
    const target = working.world.clock.now + deltaMs;
    if (!Number.isSafeInteger(target)) return this.failure('invalid-time-target');
    if (!programAdvanceWithinBudget(working.coordination, target))
      return this.failure('program-advance-budget-exceeded');
    let advanceEffects: OpenSocietyEffects = working.coordination?.actionsPolicy
      ? { effectOrder: { version: 'ordered-society-effects-v1', entries: [] } }
      : {};
    const appendEffects = (batch: OpenSocietyEffects) => {
      advanceEffects = mergeProgramEffects(advanceEffects, batch);
      events.push(...(batch.worldEvents ?? []));
      working = applyOpenSocietyEffects(working, batch);
    };
    while (working.world.clock.now < target) {
      const boundary = nextResidentLeaseBoundary(working.world);
      const until = Math.min(
        target,
        boundary ?? target,
        nextPeriodicBoundary(working.world) ?? target,
        nextLogisticsBoundary(working.world.logistics, working.world.clock.now) ?? target,
        nextEvidenceTradeBoundary(working.world.residentTrade, working.world.clock.now) ?? target,
        nextPrincipalTradeBoundary(working.world.residentTrade, working.world.clock.now) ?? target,
        nextConstructionTradeBoundary(
          working.world.residentTrade?.constructionOrders,
          working.world.clock.now,
        ) ?? target,
        nextPremisesRightsBoundary(working.world.premisesRights, working.world.clock.now) ?? target,
        (working.world.serviceEngagements
          ? nextServiceEngagementBoundary(working.world.serviceEngagements, working.world.clock.now)
          : undefined) ?? target,
        (working.world.materials
          ? nextMaterialBoundary(working.world.materials, working.world.clock.now)
          : undefined) ?? target,
        (working.world.premises
          ? nextConstructionBoundary(working.world.premises, working.world.clock.now)
          : undefined) ?? target,
        (working.world.premises
          ? nextPremisesWearBoundary(working.world.premises, working.world.clock.now)
          : undefined) ?? target,
        nextOpenPremisesBoundary(working) ?? target,
        nextMobilityBoundary(working.world.residentMobility, working.world.clock.now) ?? target,
        nextProgramBoundary(working.coordination) ?? target,
        nextCollectiveBoundary(working.collectives) ?? target,
      );
      if (until > working.world.clock.now) {
        const step = dispatchOpenWorldCommand({
          state: working,
          manifest: this.manifest,
          policies: openWorldPolicies(
            this.manifest.seed,
            working.world,
            this.manifest.rhythm,
            this.manifest.canonicalPolicyContinuation,
          ),
          actorId: 'system',
          requestId: `${requestId}-step-${events.length}`,
          commandType: 'AdvanceSimulationTime',
          payload: { deltaMs: until - working.world.clock.now },
        });
        appendEffects({ worldEvents: step });
      }
      const materialEvents = advanceOpenMaterials(
        working,
        this.manifest,
        `${requestId}-materials-${events.length}`,
      );
      appendEffects({ worldEvents: materialEvents });
      const serviceEvents = advanceResidentServiceEngagements({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `service-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: serviceEvents });
      const provisionEvents = settleResidentPremisesProvisions({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `provision-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: provisionEvents });
      const premisesEvents = advanceOpenPremises(
        working,
        this.manifest,
        `${requestId}-premises-${events.length}`,
      );
      appendEffects({ worldEvents: premisesEvents });
      if (premisesEvents.length) {
        const endedServices = advanceResidentServiceEngagements({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `service-facility-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        });
        appendEffects({ worldEvents: endedServices });
      }
      const leaseEvents = advanceResidentLeases({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-leases-${events.length}`,
        nextSequence: working.worldSequence + 1,
        policies: openWorldPolicies(
          this.manifest.seed,
          working.world,
          this.manifest.rhythm,
          this.manifest.canonicalPolicyContinuation,
        ),
      });
      appendEffects({ worldEvents: leaseEvents });
      const mobilityEvents = advanceResidentMobility({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-mobility-${events.length}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: mobilityEvents });
      const freightEvents = advanceResidentLogistics({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-freight-${events.length}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: freightEvents });
      const permitEvents = advanceResidentPremisesRights({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `permit-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: permitEvents });
      appendEffects({
        worldEvents: advanceResidentConstructionTrade({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `construction-trade-tick-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        }),
      });
      const tradeEvents = advanceResidentEvidenceTrade({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `trade-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: tradeEvents });
      appendEffects({
        worldEvents: advanceResidentPrincipalEvidenceTrade({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `principal-trade-tick-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        }),
      });
      appendEffects({
        worldEvents: advanceResourceSales({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `resource-sales-tick-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        }),
      });
      const dueCollectives = working.collectives
        ? advanceCollectives(working.collectives, working.world.clock.now)
        : [];
      appendEffects({ collectiveEvents: dueCollectives });
      const dueEffects = executeDuePrograms(working, this.manifest);
      appendEffects(dueEffects);
      if (until <= this.state.world.clock.now && leaseEvents.length === 0)
        throw new Error('lease-clock-stalled');
    }
    const next = working;
    const experiences = [
      ...worldExperiences(this.state, events),
      ...(advanceEffects.experiences ?? []),
    ];
    const residents = new Map<string, ResidentRuntimeState>(
      (advanceEffects.residents ?? []).map((r) => [r.actorId, r]),
    );
    for (const actorId of Object.keys(next.residents)) {
      const oldActivity = this.state.world.activityTimeByAgent[actorId];
      if (
        oldActivity !== undefined &&
        oldActivity.availableAt > this.state.world.clock.now &&
        oldActivity.availableAt <= next.world.clock.now
      ) {
        const resident = next.residents[actorId]!;
        residents.set(actorId, {
          ...resident,
          nextWakeAt: next.world.clock.now,
          wakeReason: 'activity-completed',
        });
      }
    }
    const reminders = Object.values(next.reminders)
      .filter((reminder) => !reminder.done && reminder.at <= next.world.clock.now)
      .map((reminder) => ({ ...reminder, done: true }));
    for (const reminder of reminders) {
      const resident = residents.get(reminder.ownerId) ?? next.residents[reminder.ownerId];
      if (resident !== undefined)
        residents.set(reminder.ownerId, {
          ...resident,
          nextWakeAt: next.world.clock.now,
          wakeReason: `reminder:${reminder.text}`,
        });
      experiences.push({
        id: `reminder-${reminder.id}`,
        ownerId: reminder.ownerId,
        at: reminder.at,
        kind: 'observation',
        summary: `Your reminder: ${reminder.text}`,
        sourceIds: [reminder.id],
        people: [],
        provenance: 'firsthand',
      });
    }
    const advanced = this.journal.commit({
      actorId: 'system',
      requestId,
      fingerprint,
      capability: 'system.advance-time',
      effects: {
        ...mergeProgramEffects(advanceEffects, {
          ...(next.collaboration
            ? { collaborationEvents: expireProposals(next.collaboration, next.world.clock.now) }
            : {}),
        }),
        experiences,
        residents: [...residents.values()],
        reminders,
      },
      result: {
        ok: true,
        data: { eventCount: events.length },
        revision: this.state.revision + 1,
        simulationTime: next.world.clock.now,
      },
    });
    this.runDuePlans();
    return advanced;
  }
  private requireResident(actorId: string) {
    if (
      this.state.residents[actorId] === undefined ||
      this.state.world.agents[actorId] === undefined
    )
      throw new ToolRefusal('unknown-resident');
  }
  private toolExperience(
    actorId: string,
    request: OpenToolRequest,
    execution: ToolExecution,
    error?: string,
  ) {
    if (ORIGINAL_READS.has(request.name))
      return error === undefined
        ? readingExperiences(this.state, actorId, request.name, execution.data)
        : [];
    const definition = OPEN_SOCIETY_TOOLS.find((tool) => tool.name === request.name);
    if (
      request.name.startsWith('world.') ||
      request.name.startsWith('messages.') ||
      (!definition?.mutates && request.name !== 'files.read')
    )
      return [];
    const data = execution.data;
    const document =
      data !== null && typeof data === 'object' && 'id' in data && 'revision' in data
        ? data
        : undefined;
    // Re-reading an unchanged document does not manufacture another experience.
    const source =
      request.name === 'files.read' && document !== undefined
        ? `document-${digest([document.id, document.revision])}`
        : `tool-${digest([actorId, request.requestId])}`;
    const id = `experience-${source}-${actorId}`;
    if (hasExperience(this.state, actorId, id)) return [];
    return [
      {
        id,
        ownerId: actorId,
        at: this.state.world.clock.now,
        kind: request.name.startsWith('cognition.') ? ('cognition' as const) : ('action' as const),
        summary: `${request.name} ${error === undefined ? 'succeeded' : `rejected: ${error}`}: ${JSON.stringify(data).slice(0, 8500)}`,
        sourceIds: [
          source,
          ...(error === undefined
            ? (execution.effects.communicationEvents ?? []).flatMap((event) =>
                event.type === 'GroupMessageSent' && event.message.authorId === actorId
                  ? [event.message.id]
                  : [],
              )
            : []),
        ],
        people: experiencePeople(this.state, data),
        provenance: request.name.startsWith('cognition.')
          ? ('self-belief' as const)
          : ('firsthand' as const),
      },
    ];
  }
  private policies() {
    return openWorldPolicies(
      this.manifest.seed,
      this.state.world,
      this.manifest.rhythm,
      this.manifest.canonicalPolicyContinuation,
    );
  }
  private failure(error: string): OpenToolResult {
    return {
      ok: false,
      error,
      revision: this.state.revision,
      simulationTime: this.state.world.clock.now,
    };
  }
  private systemCommit(
    actorId: string,
    requestId: string,
    capability: string,
    effects: OpenSocietyEffects,
    data: unknown,
  ) {
    return this.journal.commit({
      actorId,
      requestId,
      fingerprint: digest({ capability, effects }),
      capability,
      effects,
      result: {
        ok: true,
        data,
        revision: this.state.revision + 1,
        simulationTime: this.state.world.clock.now,
      },
    });
  }
}
import { executePublicGovernanceTool } from './publicGovernanceTools';

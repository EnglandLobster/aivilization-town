import { nextMobilityBoundary, validateMobilityPolicy } from '@aivilization/mobility';
import { advanceResidentMobility } from '@aivilization/world';
import { executeMobilityTool } from './mobilityTools';
import { experiencePeople, readingExperiences, ORIGINAL_READS } from './readingExperiences';
import { RESIDENT_LIFE_POLICIES } from './lifeState';
import type { WorldEvent } from '@aivilization/world';
import { COMMUNICATION_POLICY } from '@aivilization/information';
import { COLLABORATION_POLICY } from '@aivilization/collaboration';
import { COMMERCE_POLICY } from '@aivilization/commerce';
import { SERVICES_POLICY } from '@aivilization/services';
import { enableResidentCommerceEvent } from '@aivilization/world';
import { advanceCare } from '@aivilization/society';
import { nextResidentLeaseBoundary, advanceResidentLeases } from '@aivilization/world';
import { executeLifeTool } from './lifeTools';
import { advanceServices } from '@aivilization/services';
import { executeServicesTool } from './servicesTools';
import { executeCommerceTool } from './commerceTools';
import { expireProposals } from '@aivilization/collaboration';
import { executeCollaborationTool } from './collaborationTools';
import {
  validateOpenToolArguments,
  type OpenToolRequest,
  type OpenToolResult,
} from '@aivilization/agent-runtime';
import { validInformationId, DEFAULT_DISTRIBUTION_POLICY } from '@aivilization/information';
import { executeCommunicationTool } from './communicationTools';
import { executeDistributionTool } from './distributionTools';
import { CITY_APPS_VERSION } from '@aivilization/content';
import { prepareCityAppInstallation } from './cityApps';
import { OPEN_SOCIETY_TOOLS, OPEN_CAPABILITY_CATALOG_VERSION } from './catalog';
import { buildOpenResidentContext, observeResidentWorld } from './context';
import { executeCognitionTool } from './cognitionTools';
import { executeInformationTool, type ToolExecution } from './informationTools';
import { digest, OpenSocietyJournal } from './journal';
import { openWorldPolicies, serializableWorldPolicy } from './manifest';
import { executeScheduleTool } from './scheduleTools';
import { applyOpenSocietyEffects } from './state';
import { dispatchOpenWorldCommand, executeOpenWorldTool, worldExperiences } from './worldTools';
import { ToolRefusal } from './arguments';
import type {
  OpenSocietyEffects,
  OpenSocietyManifest,
  ResidentRuntimeState,
  ResidentTurn,
} from './types';

export class OpenSocietyRuntime {
  readonly journal: OpenSocietyJournal;
  constructor(rootDir: string, manifest?: OpenSocietyManifest) {
    this.journal = new OpenSocietyJournal(rootDir, manifest);
    if (
      digest(
        serializableWorldPolicy(
          this.manifest.seed,
          this.manifest.initialWorld,
          this.manifest.rhythm,
        ),
      ) !== digest(this.manifest.worldPolicies)
    ) {
      this.journal.close();
      throw new Error('world-policy-version-mismatch');
    }
    try {
      if (this.manifest.initialWorld.residentMobility)
        validateMobilityPolicy(this.manifest.initialWorld.residentMobility.policy);
      if (
        !['resident-cognition-v1', 'resident-cognition-v2'].includes(this.manifest.cognitionVersion)
      )
        throw new Error('unsupported-cognition-version');
      if (
        this.manifest.lifePolicies &&
        digest(this.manifest.lifePolicies) !== digest(RESIDENT_LIFE_POLICIES)
      )
        throw new Error('resident-life-policy-mismatch');
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
  enableLife(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-life-v1');
    if (cached) return cached.result;
    if (this.state.life)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const effects: OpenSocietyEffects = {
      lifeEnabled: 'resident-life-v1',
      ...(this.state.distribution
        ? {}
        : {
            distributionEvents: [
              { type: 'DistributionEnabled', policy: DEFAULT_DISTRIBUTION_POLICY },
            ],
          }),
      ...(this.state.communication
        ? {}
        : {
            communicationEvents: [{ type: 'CommunicationEnabled', policy: COMMUNICATION_POLICY }],
          }),
      ...(this.state.collaboration
        ? {}
        : {
            collaborationEvents: [{ type: 'CollaborationEnabled', policy: COLLABORATION_POLICY }],
          }),
      ...(this.state.services
        ? {}
        : { servicesEvents: [{ type: 'ServicesEnabled', policy: SERVICES_POLICY }] }),
      ...(this.state.world.residentCommerce
        ? {}
        : {
            worldEvents: [
              enableResidentCommerceEvent({
                simulationId: this.manifest.simulationId,
                requestId: 'enable-life-v1',
                nextSequence: this.state.worldSequence + 1,
                at: this.state.world.clock.now,
                policy: COMMERCE_POLICY,
              }),
            ],
          }),
    };
    const next = applyOpenSocietyEffects(this.state, effects);
    return this.journal.commit({
      actorId: 'system',
      requestId: 'enable-life-v1',
      fingerprint: digest(effects),
      capability: 'system.enable-life',
      effects,
      result: {
        ok: true,
        data: {
          enabled: 'resident-life-v1',
          lifePolicies: RESIDENT_LIFE_POLICIES,
          worldPolicies: serializableWorldPolicy(
            this.manifest.seed,
            next.world,
            this.manifest.rhythm,
          ),
        },
        revision: this.state.revision + 1,
        simulationTime: next.world.clock.now,
      },
    });
  }
  enableDistribution(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-distribution-v1');
    if (cached !== undefined) return cached.result;
    if (this.state.distribution !== undefined)
      return {
        ok: true,
        data: { alreadyEnabled: true, version: this.state.distribution.policy.version },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.journal.commit({
      actorId: 'system',
      requestId: 'enable-distribution-v1',
      fingerprint: digest(DEFAULT_DISTRIBUTION_POLICY),
      capability: 'system.enable-distribution',
      effects: {
        distributionEvents: [{ type: 'DistributionEnabled', policy: DEFAULT_DISTRIBUTION_POLICY }],
      },
      result: {
        ok: true,
        data: { enabled: true, version: DEFAULT_DISTRIBUTION_POLICY.version },
        revision: this.state.revision + 1,
        simulationTime: this.state.world.clock.now,
      },
    });
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
      tools: matching,
      note: 'Schemas are capability contracts, not suggested actions. Empty search returns the full authorized catalog.',
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
    input: { summary: string; status?: 'completed' | 'provider-error'; sessionId?: string },
  ): ResidentTurn {
    const resident = this.state.residents[actorId];
    const turn =
      resident?.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (resident === undefined || turn === undefined) throw new ToolRefusal('no-active-turn');
    const status =
      input.status === 'provider-error'
        ? 'provider-error'
        : turn.status === 'waiting' || turn.status === 'budget-exhausted'
          ? turn.status
          : (input.status ?? 'completed');
    const nextWakeAt = resident.wakeReason.startsWith('message:')
      ? this.state.world.clock.now
      : turn.status === 'waiting'
        ? turn.nextWakeAt
        : this.state.world.clock.now +
          (resident.freeActivityIntervalMs ?? this.manifest.policy.freeActivityIntervalMs);
    const next: ResidentTurn = {
      ...turn,
      status,
      summary: (input.summary || turn.summary).slice(0, 4000),
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
    return next;
  }
  nextResident(): string | undefined {
    return Object.values(this.state.residents)
      .filter(
        (resident) =>
          resident.nextWakeAt <= this.state.world.clock.now &&
          this.state.world.agents[resident.actorId] !== undefined,
      )
      .sort(
        (a, b) => a.lastTurnOrdinal - b.lastTurnOrdinal || a.actorId.localeCompare(b.actorId),
      )[0]?.actorId;
  }
  invoke(actorId: string, request: OpenToolRequest): OpenToolResult {
    this.requireResident(actorId);
    if (!validInformationId(request.requestId)) return this.failure('invalid-request-id');
    const fingerprint = digest({ name: request.name, arguments: request.arguments });
    const cached = this.journal.lookup(actorId, request.requestId);
    if (cached !== undefined)
      return cached.fingerprint === fingerprint
        ? cached.result
        : this.failure('request-id-conflict');
    const resident = this.state.residents[actorId]!;
    const turn =
      resident.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (turn === undefined || turn.status !== 'running') return this.failure('no-active-turn');
    if (turn.calls >= this.manifest.policy.maxCallsPerTurn) {
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
      if (request.name === 'world.observe')
        execution = {
          data: observeResidentWorld(this.state, this.manifest, actorId, this.policies(), args),
          effects: {},
        };
      else if (request.name.startsWith('world.')) {
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
      else if (['vehicles.', 'drivers.', 'rides.'].some((p) => request.name.startsWith(p)))
        execution = executeMobilityTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name === 'courses.start')
        execution = executeServicesTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        [
          'population.',
          'households.',
          'care.',
          'health.',
          'courses.',
          'leases.',
          'housing.',
          'civic.',
        ].some((p) => request.name.startsWith(p))
      )
        execution = executeLifeTool(
          this.state,
          this.manifest,
          this.policies(),
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (['services.', 'bookings.', 'queues.'].some((p) => request.name.startsWith(p)))
        execution = executeServicesTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
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
      else if (
        ['subscriptions.', 'feed.', 'notifications.'].some((prefix) =>
          request.name.startsWith(prefix),
        )
      )
        execution = executeDistributionTool(this.state, actorId, request.name, args);
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
    const changedTurn = execution.effects.turns?.find((entry) => entry.id === turn.id) ?? turn;
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
      turns: [
        ...(execution.effects.turns ?? []).filter((entry) => entry.id !== turn.id),
        { ...changedTurn, calls: turn.calls + 1 },
      ],
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
    while (working.world.clock.now < target) {
      const boundary = nextResidentLeaseBoundary(working.world);
      const until = Math.min(
        target,
        boundary ?? target,
        nextMobilityBoundary(working.world.residentMobility, working.world.clock.now) ?? target,
      );
      if (until > working.world.clock.now) {
        const step = dispatchOpenWorldCommand({
          state: working,
          manifest: this.manifest,
          policies: openWorldPolicies(this.manifest.seed, working.world, this.manifest.rhythm),
          actorId: 'system',
          requestId: `${requestId}-step-${events.length}`,
          commandType: 'AdvanceSimulationTime',
          payload: { deltaMs: until - working.world.clock.now },
        });
        events.push(...step);
        working = applyOpenSocietyEffects(working, { worldEvents: step });
      }
      const leaseEvents = advanceResidentLeases({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-leases-${events.length}`,
        nextSequence: working.worldSequence + 1,
        policies: openWorldPolicies(this.manifest.seed, working.world, this.manifest.rhythm),
      });
      events.push(...leaseEvents);
      working = applyOpenSocietyEffects(working, { worldEvents: leaseEvents });
      const mobilityEvents = advanceResidentMobility({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-mobility-${events.length}`,
        nextSequence: working.worldSequence + 1,
      });
      events.push(...mobilityEvents);
      working = applyOpenSocietyEffects(working, { worldEvents: mobilityEvents });
      if (until <= this.state.world.clock.now && leaseEvents.length === 0)
        throw new Error('lease-clock-stalled');
    }
    const next = applyOpenSocietyEffects(this.state, { worldEvents: events });
    const experiences = worldExperiences(this.state, events);
    const residents = new Map<string, ResidentRuntimeState>();
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
    const serviceEvents = next.services ? advanceServices(next.services, next.world.clock.now) : [];
    for (const event of serviceEvents) {
      if (event.type !== 'BookingChanged') continue;
      const booking = event.booking;
      const slot = next.services!.slots[booking.slotId]!;
      const service = next.services!.services[slot.serviceId]!;
      for (const ownerId of new Set([booking.residentId, service.ownerId]))
        experiences.push({
          id: `experience-booking-${booking.id}-${booking.revision}-${ownerId}`,
          ownerId,
          at: booking.endedAt ?? slot.end,
          kind: 'observation',
          summary: JSON.stringify({
            kind: 'attendance-ended',
            booking,
            serviceId: service.id,
            locationId: service.locationId,
          }),
          sourceIds: [booking.id, slot.id, service.id],
          people: [booking.residentId, service.ownerId],
          locationIds: [service.locationId],
          provenance: 'firsthand',
        });
    }
    return this.journal.commit({
      actorId: 'system',
      requestId,
      fingerprint,
      capability: 'system.advance-time',
      effects: {
        worldEvents: events,
        experiences,
        residents: [...residents.values()],
        reminders,
        ...(next.collaboration
          ? { collaborationEvents: expireProposals(next.collaboration, next.world.clock.now) }
          : {}),
        ...(next.services ? { servicesEvents: serviceEvents } : {}),
        ...(next.life ? { careEvents: advanceCare(next.life.care, next.world.clock.now) } : {}),
      },
      result: {
        ok: true,
        data: { eventCount: events.length },
        revision: this.state.revision + 1,
        simulationTime: next.world.clock.now,
      },
    });
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
    if (this.state.experiences[actorId]?.some((entry) => entry.id === id)) return [];
    return [
      {
        id,
        ownerId: actorId,
        at: this.state.world.clock.now,
        kind: request.name.startsWith('cognition.') ? ('cognition' as const) : ('action' as const),
        summary: `${request.name} ${error === undefined ? 'succeeded' : `rejected: ${error}`}: ${JSON.stringify(data).slice(0, 8500)}`,
        sourceIds: [source],
        people: experiencePeople(this.state, data),
        provenance: request.name.startsWith('cognition.')
          ? ('self-belief' as const)
          : ('firsthand' as const),
      },
    ];
  }
  private policies() {
    return openWorldPolicies(this.manifest.seed, this.state.world, this.manifest.rhythm);
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

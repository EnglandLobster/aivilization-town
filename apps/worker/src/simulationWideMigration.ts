import { createHash } from 'node:crypto';
import {
  asAgentId,
  createCommandEnvelope,
  createSeededRandom,
  type AgentId,
  type PartitionKey,
  type SimulationId,
} from '@aivilization/sim-core';
import { evaluateInMigrationDemand, type InMigrationPolicy } from '@aivilization/society';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';

export function settleDemandDrivenArrivals(input: {
  readonly simulationId: SimulationId;
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly revision: number;
  readonly projection: WorldProjection;
  readonly existingEvents: readonly WorldEvent[];
  readonly ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>;
  readonly partitionKeys: readonly PartitionKey[];
  readonly partitionAccountsByKey?: Readonly<
    Record<string, Pick<WorldProjection, 'moneySupply' | 'treasury'>>
  >;
  readonly commandPolicies: WorldCommandPolicies;
  readonly migrationPolicyVersion?: string;
  readonly fallbackWellbeing?: number;
  readonly policy?: InMigrationPolicy;
}): {
  readonly projection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>;
  readonly partitionAccountsByKey:
    | Readonly<Record<string, Pick<WorldProjection, 'moneySupply' | 'treasury'>>>
    | undefined;
  readonly registeredAgents: readonly {
    readonly agentId: AgentId;
    readonly ownerPartitionKey: PartitionKey;
  }[];
} {
  if (
    input.policy === undefined ||
    input.migrationPolicyVersion === undefined ||
    input.fallbackWellbeing === undefined
  ) {
    return {
      projection: input.projection,
      events: input.existingEvents,
      ownerPartitionKeyByAgentId: input.ownerPartitionKeyByAgentId,
      partitionAccountsByKey: input.partitionAccountsByKey,
      registeredAgents: [],
    };
  }
  const policy = input.policy;
  const migrationPolicyVersion = input.migrationPolicyVersion;
  const fallbackWellbeing = input.fallbackWellbeing;

  let projection = input.projection;
  const events = [...input.existingEvents];
  const owners = { ...input.ownerPartitionKeyByAgentId };
  const partitionAccounts =
    input.partitionAccountsByKey === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(input.partitionAccountsByKey).map(([partitionKey, accounts]) => [
            partitionKey,
            { ...accounts },
          ]),
        );
  const registeredAgents: {
    agentId: AgentId;
    ownerPartitionKey: PartitionKey;
  }[] = [];
  const boundaries = enumerateCadenceBoundaries(
    input.previousSimulationTime,
    input.nextSimulationTime,
    policy.settlementCadenceMs,
  );
  const { agentRegistration: strippedRegistration, ...registrationPolicies } =
    input.commandPolicies;
  void strippedRegistration;

  for (const settledAt of boundaries) {
    const populationBefore = Object.keys(projection.agents).length;
    const residentialCapacity = Object.values(projection.locations).reduce(
      (total, location) =>
        location.kind === 'residence' && location.capacity !== null
          ? total + location.capacity
          : total,
      0,
    );
    const openJobSlots = Object.values(projection.enterprises).reduce(
      (total, enterprise) => total + (enterprise.jobPosting?.openSlots ?? 0),
      0,
    );
    const wellbeingValues = Object.values(projection.agents).map(
      (agent) => agent.wellbeing ?? fallbackWellbeing,
    );
    const averageWellbeing =
      wellbeingValues.length === 0
        ? fallbackWellbeing
        : wellbeingValues.reduce((total, value) => total + value, 0) / wellbeingValues.length;
    const roll = createSeededRandom(
      `${input.commandPolicies.randomSeed ?? input.simulationId}:${input.simulationId}:${migrationPolicyVersion}:arrival:${settledAt}`,
    ).nextFloat();
    const decision = evaluateInMigrationDemand({
      population: populationBefore,
      residentialCapacity,
      openJobSlots,
      averageWellbeing,
      roll,
      policy,
    });

    for (let index = 0; index < decision.arrivalCount; index += 1) {
      const agentId = asAgentId(
        `immigrant-${sha256Hex(`${input.simulationId}:${settledAt}:${index}`).slice(0, 20)}`,
      );
      const ownerPartitionKey = selectLeastPopulatedPartition(input.partitionKeys, owners);
      const commandId = `simulation-wide-migration-${settledAt}-${index}`;
      const registrationEvents = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: commandId,
          simulationId: input.simulationId,
          source: 'system',
          type: 'RegisterAgent',
          actorId: agentId,
          payload: {
            agentId,
            creatorId: 'town-migration',
            displayName: `Newcomer ${agentId.slice(-6)}`,
          },
          issuedAt: settledAt,
        }),
        projection,
        policies: registrationPolicies,
        nextSequence: input.revision + events.length + 1,
      });
      const registered = registrationEvents[0];
      if (registered?.type === 'AgentRegistrationRejected') {
        if (registered.payload.reason === 'population-capacity-reached') break;
        throw new Error(
          `demand-driven migration registration rejected for ${agentId}: ${registered.payload.reason}`,
        );
      }
      if (registered?.type !== 'AgentRegistered' || registrationEvents.length !== 1) {
        throw new Error(`demand-driven migration produced invalid registration for ${agentId}`);
      }
      const arrivalEvent: Extract<WorldEvent, { readonly type: 'AgentRegistered' }> = {
        ...registered,
        payload: {
          ...registered.payload,
          migrationArrival: {
            migrationPolicyVersion,
            settledAt,
            populationBefore,
            residentialCapacity,
            openJobSlots,
            averageWellbeing,
            housingVacancies: decision.housingVacancies,
            demandScore: decision.demandScore,
          },
        },
      };
      events.push(arrivalEvent);
      projection = applyWorldEvent(projection, arrivalEvent);
      owners[agentId] = ownerPartitionKey;
      registeredAgents.push({ agentId, ownerPartitionKey });
      if (partitionAccounts !== undefined) {
        const ownerAccounts = partitionAccounts[ownerPartitionKey];
        if (ownerAccounts === undefined) {
          throw new Error(`missing partition accounts for migration owner ${ownerPartitionKey}`);
        }
        partitionAccounts[ownerPartitionKey] = {
          ...ownerAccounts,
          moneySupply: ownerAccounts.moneySupply + arrivalEvent.payload.moneySupplyDelta,
        };
      }
    }
  }

  return {
    projection,
    events,
    ownerPartitionKeyByAgentId: owners,
    partitionAccountsByKey: partitionAccounts,
    registeredAgents,
  };
}

function enumerateCadenceBoundaries(
  previousSimulationTime: number,
  nextSimulationTime: number,
  cadenceMs: number,
): readonly number[] {
  const boundaries: number[] = [];
  let boundary = (Math.floor(previousSimulationTime / cadenceMs) + 1) * cadenceMs;
  while (boundary <= nextSimulationTime) {
    boundaries.push(boundary);
    boundary += cadenceMs;
  }
  return boundaries;
}

function selectLeastPopulatedPartition(
  partitionKeys: readonly PartitionKey[],
  ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>,
): PartitionKey {
  const counts = new Map(partitionKeys.map((partitionKey) => [partitionKey, 0]));
  for (const owner of Object.values(ownerPartitionKeyByAgentId)) {
    if (counts.has(owner)) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const selected = [...partitionKeys].sort((left, right) => {
    const countDifference = (counts.get(left) ?? 0) - (counts.get(right) ?? 0);
    return countDifference === 0 ? left.localeCompare(right) : countDifference;
  })[0];
  if (selected === undefined) throw new Error('migration requires at least one owner partition');
  return selected;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

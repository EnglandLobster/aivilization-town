import {
  createTownParticipantAccessController,
  createTownParticipantAccessPolicy,
  createTownOidcJwksAuthenticator,
  createTownStaticBearerAuthenticatorFromDigests,
  type TownHttpApiHandler,
  type TownNodeHttpAuthenticator,
  type TownParticipantAccessController,
  type TownParticipantAccessOwnershipPort,
  type TownParticipantAccessPolicy,
  type TownParticipantMutationRateLimitCategory,
  type TownParticipantMutationRateLimitPort,
  type TownOidcJwksAuthenticatorConfig,
  type TownStaticBearerCredentialDigest,
} from '@aivilization/api';
import { AppendOnlyJsonLinesFile } from '@aivilization/sim-core';
import { join } from 'node:path';
import type { LocalSimulationRuntimeHost } from '@aivilization/worker';
import { createLocalRuntimeTownParticipantDataDeletionPolicy } from './localRuntimeTownParticipantDataDeletion';
import { LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION } from './localRuntimeTownParticipantDataLifecycle';

export const LOCAL_RUNTIME_TOWN_PARTICIPANT_ACCESS_COMPOSITION_VERSION =
  'local-participant-access-v2';

export type LocalRuntimeTownParticipantAccessConfig =
  | {
      readonly mode: 'open';
    }
  | {
      readonly mode: 'authenticated';
      readonly maxAgentsPerParticipant: number;
      readonly credentials: readonly TownStaticBearerCredentialDigest[];
      readonly oidc?: never;
    }
  | {
      readonly mode: 'authenticated';
      readonly maxAgentsPerParticipant: number;
      readonly oidc: TownOidcJwksAuthenticatorConfig;
      readonly credentials?: never;
    };

export type LocalRuntimeTownParticipantAccessRuntime = {
  readonly policy: TownParticipantAccessPolicy;
  readonly controller: TownParticipantAccessController;
  readonly authenticator?: TownNodeHttpAuthenticator;
};

export function createLocalRuntimeTownParticipantAccessPolicy(
  config: LocalRuntimeTownParticipantAccessConfig | undefined,
): TownParticipantAccessPolicy {
  const resolved = config ?? { mode: 'open' as const };
  return createTownParticipantAccessPolicy(
    resolved.mode === 'open'
      ? { mode: 'open' }
      : {
          mode: 'authenticated',
          maxAgentsPerParticipant: resolved.maxAgentsPerParticipant,
        },
  );
}

export function createLocalRuntimeTownParticipantAccessManifest(
  config: LocalRuntimeTownParticipantAccessConfig | undefined,
) {
  const resolved = config ?? { mode: 'open' as const };
  const policy = createLocalRuntimeTownParticipantAccessPolicy(resolved);
  return {
    compositionVersion: LOCAL_RUNTIME_TOWN_PARTICIPANT_ACCESS_COMPOSITION_VERSION,
    ...policy,
    authenticator:
      resolved.mode === 'open'
        ? 'none-loopback-only'
        : resolved.oidc === undefined
          ? 'static-bearer'
          : 'oidc-jwks',
    credentialHandling:
      resolved.mode === 'open'
        ? null
        : resolved.oidc === undefined
          ? {
              credentialCount: resolved.credentials.length,
              retainedRepresentation: 'sha256-digest-only-after-startup',
              secretPersistence: 'never-in-runtime-manifest-or-durable-state',
            }
          : null,
    identityProvider:
      resolved.mode === 'authenticated' && resolved.oidc !== undefined
        ? {
            ...resolved.oidc,
            remoteKeyCache: 'jose-createRemoteJWKSet-memory-cache-with-key-rotation',
            rawTokenPersistence: 'never',
          }
        : null,
    rateLimitStorage:
      resolved.mode === 'open'
        ? null
        : 'append-only-jsonl-survives-process-restart-shared-runtime-root',
    participantDataDeletion: createLocalRuntimeTownParticipantDataDeletionPolicy(),
    participantDataLifecycle: {
      policyVersion: LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION,
      retentionDurations: 'deployment-defined-per-request',
      auditIntegrity: 'append-only-sha256-chain',
      subjectPersistence: 'hmac-sha256-reference-only',
    },
  } as const;
}

export function createLocalRuntimeTownParticipantAccessRuntime(input: {
  readonly config?: LocalRuntimeTownParticipantAccessConfig;
  readonly host: LocalSimulationRuntimeHost;
  readonly next: TownHttpApiHandler;
}): LocalRuntimeTownParticipantAccessRuntime {
  const config = input.config ?? { mode: 'open' as const };
  const policy = createLocalRuntimeTownParticipantAccessPolicy(config);
  const ownership = createLocalRuntimeTownParticipantOwnershipPort(input.host);
  const controller = createTownParticipantAccessController({
    next: input.next,
    policy,
    ownership,
    ...(config.mode === 'open'
      ? {}
      : {
          rateLimits: new FileParticipantMutationRateLimitPort({ rootDir: input.host.rootDir }),
        }),
  });
  const authenticator =
    config.mode === 'open'
      ? undefined
      : config.oidc === undefined
        ? createTownStaticBearerAuthenticatorFromDigests({ credentials: config.credentials })
        : createTownOidcJwksAuthenticator({ config: config.oidc });
  return {
    policy,
    controller,
    ...(authenticator === undefined ? {} : { authenticator }),
  };
}

type ParticipantMutationRateLimitRecord = {
  readonly principalSubjectId: string;
  readonly category: TownParticipantMutationRateLimitCategory;
  readonly occurredAt: number;
};

export class FileParticipantMutationRateLimitPort implements TownParticipantMutationRateLimitPort {
  private readonly ledger: AppendOnlyJsonLinesFile<ParticipantMutationRateLimitRecord>;
  private queue: Promise<void> = Promise.resolve();

  constructor(input: { readonly rootDir: string }) {
    if (input.rootDir.trim().length === 0) {
      throw new Error('participant rate-limit rootDir must be non-empty');
    }
    this.ledger = new AppendOnlyJsonLinesFile(
      join(input.rootDir, 'participant-mutation-rate-limits.jsonl'),
    );
  }

  consume(
    input: Parameters<TownParticipantMutationRateLimitPort['consume']>[0],
  ): ReturnType<TownParticipantMutationRateLimitPort['consume']> {
    const operation = this.queue.then(() => this.consumeSerial(input));
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private consumeSerial(input: Parameters<TownParticipantMutationRateLimitPort['consume']>[0]) {
    if (!Number.isFinite(input.occurredAt)) {
      throw new Error('participant rate-limit occurredAt must be finite');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error('participant rate-limit limit must be a positive integer');
    }
    if (!Number.isFinite(input.windowMs) || input.windowMs <= 0) {
      throw new Error('participant rate-limit windowMs must be positive finite');
    }
    const windowStartedAt = input.occurredAt - input.windowMs;
    const recent = this.ledger
      .read()
      .filter(
        (record) =>
          record.principalSubjectId === input.principalSubjectId &&
          record.category === input.category &&
          record.occurredAt > windowStartedAt &&
          record.occurredAt <= input.occurredAt,
      )
      .sort((left, right) => left.occurredAt - right.occurredAt);
    if (recent.length >= input.limit) {
      return {
        status: 'rejected' as const,
        retryAfterMs: Math.max(
          1,
          (recent[0]?.occurredAt ?? input.occurredAt) + input.windowMs - input.occurredAt,
        ),
      };
    }
    this.ledger.append([
      {
        principalSubjectId: input.principalSubjectId,
        category: input.category,
        occurredAt: input.occurredAt,
      },
    ]);
    return { status: 'accepted' as const, remaining: input.limit - recent.length - 1 };
  }
}

function createLocalRuntimeTownParticipantOwnershipPort(
  host: LocalSimulationRuntimeHost,
): TownParticipantAccessOwnershipPort {
  return {
    getAgentOwner: async (request) => {
      const result = await host.registry.api.getProjection(request);
      return result.projection.agents[request.agentId]?.registration?.creatorId;
    },
    countOwnedAgents: async (request) => {
      const result = await host.registry.api.getProjection(request);
      return Object.values(result.projection.agents).reduce(
        (count, agent) => count + (agent.registration?.creatorId === request.ownerId ? 1 : 0),
        0,
      );
    },
  };
}

import type { TownAccessRole, TownAuthenticatedPrincipal } from './httpAuthentication';
import type { HumanCommandAttribution } from '@aivilization/sim-core';
import type { TownHttpApiHandler, TownHttpApiRequest, TownHttpApiResponse } from './httpApi';

export const TOWN_PARTICIPANT_ACCESS_POLICY_VERSION = 'participant-access-control-v2';
export const TOWN_PARTICIPANT_CONSENT_POLICY_VERSION = 'participant-data-consent-v1';
export const DEFAULT_MAX_AGENTS_PER_PARTICIPANT = 16;
export const PARTICIPANT_REGISTRATION_RATE_LIMIT = { limit: 4, windowMs: 3_600_000 } as const;
export const PARTICIPANT_STEERING_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

export type TownParticipantAccessMode = 'open' | 'authenticated';

export type TownParticipantAccessPolicy = {
  readonly policyVersion: typeof TOWN_PARTICIPANT_ACCESS_POLICY_VERSION;
  readonly source: 'repository-design';
  readonly mode: TownParticipantAccessMode;
  readonly publicReadAccess: true;
  readonly participantMutationAuthentication: 'none-local-open-mode' | 'bearer-principal-required';
  readonly creatorBinding: 'request-attribution-label' | 'authenticated-principal-subject';
  readonly steeringAuthorization: 'unrestricted-local-mode' | 'owner-or-operator';
  readonly runtimeMutationAuthorization: 'unrestricted-local-mode' | 'operator-only';
  readonly maxAgentsPerParticipant: number | null;
  readonly quotaAuthority: 'world-command-plus-api-precheck';
  readonly credentialMaterialInManifest: false;
  readonly tlsTermination: 'external-deployment-responsibility';
  readonly consentPolicyVersion: typeof TOWN_PARTICIPANT_CONSENT_POLICY_VERSION | null;
  readonly consentRule: 'not-required-local-open-mode' | 'explicit-version-on-every-mutation';
  readonly attributionRule: 'none-local-open-mode' | 'durable-human-command-attribution';
  readonly retentionBoundary: 'deployment-policy-required-before-public-launch';
  readonly mutationRateLimits: null | {
    readonly registration: typeof PARTICIPANT_REGISTRATION_RATE_LIMIT;
    readonly steering: typeof PARTICIPANT_STEERING_RATE_LIMIT;
  };
  readonly rateLimitAuthority: 'none-local-open-mode' | 'injected-durable-ledger';
};

export type TownParticipantAccessOwnershipPort = {
  readonly getAgentOwner: (input: {
    readonly simulationId: string;
    readonly partitionKey: string;
    readonly agentId: string;
  }) => Promise<string | undefined>;
  readonly countOwnedAgents: (input: {
    readonly simulationId: string;
    readonly partitionKey: string;
    readonly ownerId: string;
  }) => Promise<number>;
};

export type TownParticipantMutationRateLimitCategory = 'registration' | 'steering';

export type TownParticipantMutationRateLimitPort = {
  readonly consume: (input: {
    readonly principalSubjectId: string;
    readonly category: TownParticipantMutationRateLimitCategory;
    readonly occurredAt: number;
    readonly limit: number;
    readonly windowMs: number;
  }) => Promise<
    | { readonly status: 'accepted'; readonly remaining: number }
    | { readonly status: 'rejected'; readonly retryAfterMs: number }
  >;
};

export type TownParticipantAccessController = {
  readonly policy: TownParticipantAccessPolicy;
  readonly handle: TownHttpApiHandler;
};

type SimulationMutationRoute = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly action: string;
};

class TownParticipantAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const jsonHeaders = { 'content-type': 'application/json' };

export function createTownParticipantAccessPolicy(input: {
  readonly mode: TownParticipantAccessMode;
  readonly maxAgentsPerParticipant?: number;
}): TownParticipantAccessPolicy {
  if (input.mode === 'open') {
    if (input.maxAgentsPerParticipant !== undefined) {
      throw new Error('maxAgentsPerParticipant is only valid in authenticated mode');
    }
    return {
      policyVersion: TOWN_PARTICIPANT_ACCESS_POLICY_VERSION,
      source: 'repository-design',
      mode: 'open',
      publicReadAccess: true,
      participantMutationAuthentication: 'none-local-open-mode',
      creatorBinding: 'request-attribution-label',
      steeringAuthorization: 'unrestricted-local-mode',
      runtimeMutationAuthorization: 'unrestricted-local-mode',
      maxAgentsPerParticipant: null,
      quotaAuthority: 'world-command-plus-api-precheck',
      credentialMaterialInManifest: false,
      tlsTermination: 'external-deployment-responsibility',
      consentPolicyVersion: null,
      consentRule: 'not-required-local-open-mode',
      attributionRule: 'none-local-open-mode',
      retentionBoundary: 'deployment-policy-required-before-public-launch',
      mutationRateLimits: null,
      rateLimitAuthority: 'none-local-open-mode',
    };
  }
  const maxAgentsPerParticipant =
    input.maxAgentsPerParticipant ?? DEFAULT_MAX_AGENTS_PER_PARTICIPANT;
  assertPositiveInteger(maxAgentsPerParticipant, 'maxAgentsPerParticipant');
  return {
    policyVersion: TOWN_PARTICIPANT_ACCESS_POLICY_VERSION,
    source: 'repository-design',
    mode: 'authenticated',
    publicReadAccess: true,
    participantMutationAuthentication: 'bearer-principal-required',
    creatorBinding: 'authenticated-principal-subject',
    steeringAuthorization: 'owner-or-operator',
    runtimeMutationAuthorization: 'operator-only',
    maxAgentsPerParticipant,
    quotaAuthority: 'world-command-plus-api-precheck',
    credentialMaterialInManifest: false,
    tlsTermination: 'external-deployment-responsibility',
    consentPolicyVersion: TOWN_PARTICIPANT_CONSENT_POLICY_VERSION,
    consentRule: 'explicit-version-on-every-mutation',
    attributionRule: 'durable-human-command-attribution',
    retentionBoundary: 'deployment-policy-required-before-public-launch',
    mutationRateLimits: {
      registration: PARTICIPANT_REGISTRATION_RATE_LIMIT,
      steering: PARTICIPANT_STEERING_RATE_LIMIT,
    },
    rateLimitAuthority: 'injected-durable-ledger',
  };
}

export function createTownParticipantAccessController(input: {
  readonly next: TownHttpApiHandler;
  readonly policy: TownParticipantAccessPolicy;
  readonly ownership: TownParticipantAccessOwnershipPort;
  readonly rateLimits?: TownParticipantMutationRateLimitPort;
  readonly now?: () => number;
}): TownParticipantAccessController {
  if (input.policy.mode === 'authenticated' && input.rateLimits === undefined) {
    throw new Error(
      'authenticated participant access requires an injected durable mutation rate-limit ledger',
    );
  }
  const rateLimits = input.rateLimits ?? createInMemoryParticipantMutationRateLimitPort();
  const now = input.now ?? Date.now;
  return {
    policy: input.policy,
    handle: async (request) => {
      try {
        if (request.method === 'GET' && request.path === '/access/session') {
          return createSessionResponse(input.policy, request.principal);
        }
        if (request.method === 'GET') {
          return input.next(request);
        }
        if (input.policy.mode === 'open') {
          return input.next(stripReservedParticipantMetadata(request));
        }

        const route = matchSimulationMutationRoute(request.path);
        if (route?.action === 'agents') {
          return input.next(
            await authorizeAgentRegistration({
              request,
              route,
              policy: input.policy,
              ownership: input.ownership,
              rateLimits,
              now,
            }),
          );
        }
        if (route?.action === 'objectives' || route?.action === 'reactive-commands') {
          return input.next(
            await authorizeAgentSteering({
              request,
              route,
              policy: input.policy,
              ownership: input.ownership,
              rateLimits,
              now,
            }),
          );
        }
        requireRole(requirePrincipal(request.principal), 'operator');
        return input.next(request);
      } catch (error) {
        if (error instanceof TownParticipantAccessError) {
          return {
            status: error.status,
            headers:
              error.status === 401
                ? { ...jsonHeaders, 'www-authenticate': 'Bearer realm="aivilization-town"' }
                : jsonHeaders,
            body: { error: { code: error.code, message: error.message } },
          };
        }
        throw error;
      }
    },
  };
}

function stripReservedParticipantMetadata(request: TownHttpApiRequest): TownHttpApiRequest {
  if (request.body === undefined) return request;
  const body = requireRecord(request.body);
  const safeBody = Object.fromEntries(
    Object.entries(body).filter(
      ([key]) => key !== 'humanAttribution' && key !== 'consentPolicyVersion',
    ),
  );
  return { ...request, body: safeBody };
}

function createSessionResponse(
  policy: TownParticipantAccessPolicy,
  principal: TownAuthenticatedPrincipal | undefined,
): TownHttpApiResponse {
  return {
    status: 200,
    headers: jsonHeaders,
    body: {
      policy,
      authentication: {
        requiredForMutations: policy.mode === 'authenticated',
        authenticated: principal !== undefined,
        ...(principal === undefined
          ? {}
          : {
              principal: {
                subjectId: principal.subjectId,
                roles: [...principal.roles],
              },
            }),
      },
    },
  };
}

async function authorizeAgentRegistration(input: {
  readonly request: TownHttpApiRequest;
  readonly route: SimulationMutationRoute;
  readonly policy: TownParticipantAccessPolicy;
  readonly ownership: TownParticipantAccessOwnershipPort;
  readonly rateLimits: TownParticipantMutationRateLimitPort;
  readonly now: () => number;
}): Promise<TownHttpApiRequest> {
  const principal = requirePrincipal(input.request.principal);
  requireAnyRole(principal, ['participant', 'operator']);
  const body = requireRecord(input.request.body);
  const requestedCreatorId = optionalNonEmptyString(body.creatorId, 'creatorId');
  const creatorId = principal.roles.includes('operator')
    ? (requestedCreatorId ?? principal.subjectId)
    : principal.subjectId;
  if (requestedCreatorId !== undefined && creatorId !== requestedCreatorId) {
    throw new TownParticipantAccessError(
      403,
      'creator_identity_mismatch',
      'creatorId must match the authenticated participant subject',
    );
  }
  const humanAttribution = requireHumanAttribution({
    body,
    principal,
    policy: input.policy,
  });
  await enforceParticipantMutationRateLimit({
    policy: input.policy,
    rateLimits: input.rateLimits,
    principalSubjectId: principal.subjectId,
    category: 'registration',
    occurredAt: input.now(),
  });
  const maximum = input.policy.maxAgentsPerParticipant;
  if (maximum === null) {
    throw new Error('authenticated access policy must define maxAgentsPerParticipant');
  }
  const currentCount = await input.ownership.countOwnedAgents({
    simulationId: input.route.simulationId,
    partitionKey: input.route.partitionKey,
    ownerId: creatorId,
  });
  if (!Number.isInteger(currentCount) || currentCount < 0) {
    throw new Error('ownership port returned an invalid owned-agent count');
  }
  if (currentCount >= maximum) {
    throw new TownParticipantAccessError(
      429,
      'participant_agent_quota_reached',
      `participant ${creatorId} already owns the maximum ${maximum} agents`,
    );
  }
  return {
    ...input.request,
    body: { ...body, creatorId, humanAttribution },
  };
}

async function authorizeAgentSteering(input: {
  readonly request: TownHttpApiRequest;
  readonly route: SimulationMutationRoute;
  readonly policy: TownParticipantAccessPolicy;
  readonly ownership: TownParticipantAccessOwnershipPort;
  readonly rateLimits: TownParticipantMutationRateLimitPort;
  readonly now: () => number;
}): Promise<TownHttpApiRequest> {
  const principal = requirePrincipal(input.request.principal);
  const body = requireRecord(input.request.body);
  const agentId = requireNonEmptyString(body.agentId, 'agentId');
  if (!principal.roles.includes('operator')) {
    requireRole(principal, 'participant');
    const ownerId = await input.ownership.getAgentOwner({
      simulationId: input.route.simulationId,
      partitionKey: input.route.partitionKey,
      agentId,
    });
    if (ownerId !== principal.subjectId) {
      throw new TownParticipantAccessError(
        403,
        'agent_not_owned',
        `participant ${principal.subjectId} does not own agent ${agentId}`,
      );
    }
  }
  const humanAttribution = requireHumanAttribution({
    body,
    principal,
    policy: input.policy,
  });
  await enforceParticipantMutationRateLimit({
    policy: input.policy,
    rateLimits: input.rateLimits,
    principalSubjectId: principal.subjectId,
    category: 'steering',
    occurredAt: input.now(),
  });
  return { ...input.request, body: { ...body, humanAttribution } };
}

async function enforceParticipantMutationRateLimit(input: {
  readonly policy: TownParticipantAccessPolicy;
  readonly rateLimits: TownParticipantMutationRateLimitPort;
  readonly principalSubjectId: string;
  readonly category: TownParticipantMutationRateLimitCategory;
  readonly occurredAt: number;
}): Promise<void> {
  const limits = input.policy.mutationRateLimits;
  if (limits === null) return;
  const configured = limits[input.category];
  const result = await input.rateLimits.consume({
    principalSubjectId: input.principalSubjectId,
    category: input.category,
    occurredAt: input.occurredAt,
    ...configured,
  });
  if (result.status === 'rejected') {
    throw new TownParticipantAccessError(
      429,
      'participant_rate_limit_reached',
      `${input.category} rate limit reached; retry after ${result.retryAfterMs}ms`,
    );
  }
}

export function createInMemoryParticipantMutationRateLimitPort(): TownParticipantMutationRateLimitPort {
  const timestampsByKey = new Map<string, number[]>();
  return {
    consume: (input) => {
      const key = `${input.principalSubjectId}:${input.category}`;
      const windowStartedAt = input.occurredAt - input.windowMs;
      const recent = (timestampsByKey.get(key) ?? []).filter(
        (occurredAt) => occurredAt > windowStartedAt,
      );
      if (recent.length >= input.limit) {
        return Promise.resolve({
          status: 'rejected' as const,
          retryAfterMs: Math.max(
            1,
            (recent[0] ?? input.occurredAt) + input.windowMs - input.occurredAt,
          ),
        });
      }
      recent.push(input.occurredAt);
      timestampsByKey.set(key, recent);
      return Promise.resolve({
        status: 'accepted' as const,
        remaining: input.limit - recent.length,
      });
    },
  };
}

function requireHumanAttribution(input: {
  readonly body: Readonly<Record<string, unknown>>;
  readonly principal: TownAuthenticatedPrincipal;
  readonly policy: TownParticipantAccessPolicy;
}): HumanCommandAttribution {
  const presentedConsentPolicyVersion = input.body['consentPolicyVersion'];
  const consentPolicyVersion =
    typeof presentedConsentPolicyVersion === 'string' ? presentedConsentPolicyVersion.trim() : '';
  if (
    consentPolicyVersion.length === 0 ||
    consentPolicyVersion !== input.policy.consentPolicyVersion
  ) {
    throw new TownParticipantAccessError(
      428,
      'participant_consent_required',
      `consentPolicyVersion must equal ${input.policy.consentPolicyVersion}`,
    );
  }
  return {
    principalSubjectId: input.principal.subjectId,
    principalRoles: [...input.principal.roles],
    accessPolicyVersion: input.policy.policyVersion,
    consentPolicyVersion,
  };
}

function matchSimulationMutationRoute(path: string): SimulationMutationRoute | undefined {
  const segments = path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodePathSegment);
  if (segments.length !== 5 || segments[0] !== 'simulations' || segments[2] !== 'partitions') {
    return undefined;
  }
  const simulationId = segments[1];
  const partitionKey = segments[3];
  const action = segments[4];
  if (simulationId === undefined || partitionKey === undefined || action === undefined) {
    return undefined;
  }
  return { simulationId, partitionKey, action };
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TownParticipantAccessError(400, 'bad_request', 'path contains invalid encoding');
  }
}

function requirePrincipal(
  principal: TownAuthenticatedPrincipal | undefined,
): TownAuthenticatedPrincipal {
  if (principal === undefined) {
    throw new TownParticipantAccessError(
      401,
      'authentication_required',
      'a valid Bearer access token is required for this mutation',
    );
  }
  return principal;
}

function requireAnyRole(
  principal: TownAuthenticatedPrincipal,
  roles: readonly TownAccessRole[],
): void {
  if (!roles.some((role) => principal.roles.includes(role))) {
    throw new TownParticipantAccessError(
      403,
      'insufficient_role',
      `one of the following roles is required: ${roles.join(', ')}`,
    );
  }
}

function requireRole(principal: TownAuthenticatedPrincipal, role: TownAccessRole): void {
  requireAnyRole(principal, [role]);
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TownParticipantAccessError(400, 'bad_request', 'request body must be an object');
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TownParticipantAccessError(400, 'bad_request', `${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalNonEmptyString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireNonEmptyString(value, name);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

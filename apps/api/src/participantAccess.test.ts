import { describe, expect, test } from 'vitest';
import type { TownHttpApiRequest } from './httpApi';
import {
  createInMemoryParticipantMutationRateLimitPort,
  createTownParticipantAccessController,
  createTownParticipantAccessPolicy,
  type TownParticipantAccessOwnershipPort,
} from './participantAccess';

const basePath = '/simulations/sim-1/partitions/world-main';

describe('town participant access control', () => {
  test('fails closed when authenticated mode has no durable rate-limit authority', () => {
    expect(() =>
      createTownParticipantAccessController({
        next: () => Promise.resolve({ status: 202, headers: {}, body: {} }),
        policy: createTownParticipantAccessPolicy({ mode: 'authenticated' }),
        ownership: createOwnership(),
      }),
    ).toThrow('requires an injected durable mutation rate-limit ledger');
  });

  test('binds authenticated participant identity to registration and enforces quota precheck', async () => {
    const forwarded: TownHttpApiRequest[] = [];
    const controller = createController({
      countByOwner: { 'participant-7': 1, full: 2 },
      maximum: 2,
      forwarded,
    });

    const accepted = await controller.handle({
      method: 'POST',
      path: `${basePath}/agents`,
      body: {
        agentId: 'agent-new',
        displayName: 'New Agent',
        issuedAt: 100,
        consentPolicyVersion: 'participant-data-consent-v1',
      },
      principal: { subjectId: 'participant-7', roles: ['participant'] },
    });
    expect(accepted.status).toBe(202);
    expect(forwarded[0]?.body).toEqual({
      agentId: 'agent-new',
      displayName: 'New Agent',
      issuedAt: 100,
      creatorId: 'participant-7',
      consentPolicyVersion: 'participant-data-consent-v1',
      humanAttribution: {
        principalSubjectId: 'participant-7',
        principalRoles: ['participant'],
        accessPolicyVersion: 'participant-access-control-v2',
        consentPolicyVersion: 'participant-data-consent-v1',
      },
    });

    const quota = await controller.handle({
      method: 'POST',
      path: `${basePath}/agents`,
      body: {
        agentId: 'agent-full',
        displayName: 'Full',
        issuedAt: 100,
        consentPolicyVersion: 'participant-data-consent-v1',
      },
      principal: { subjectId: 'full', roles: ['participant'] },
    });
    expect(quota).toMatchObject({
      status: 429,
      body: { error: { code: 'participant_agent_quota_reached' } },
    });
  });

  test('rejects missing identity, creator spoofing, and cross-owner steering', async () => {
    const controller = createController({
      owners: { 'agent-owned': 'participant-7', 'agent-other': 'participant-8' },
    });

    await expectStatus(controller.handle, {
      request: {
        method: 'POST',
        path: `${basePath}/agents`,
        body: { agentId: 'new', displayName: 'New', issuedAt: 100 },
      },
      status: 401,
      code: 'authentication_required',
    });
    await expectStatus(controller.handle, {
      request: {
        method: 'POST',
        path: `${basePath}/objectives`,
        body: { agentId: 'agent-owned' },
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
      status: 428,
      code: 'participant_consent_required',
    });
    await expectStatus(controller.handle, {
      request: {
        method: 'POST',
        path: `${basePath}/agents`,
        body: { agentId: 'new', creatorId: 'participant-8', displayName: 'New', issuedAt: 100 },
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
      status: 403,
      code: 'creator_identity_mismatch',
    });
    await expectStatus(controller.handle, {
      request: {
        method: 'POST',
        path: `${basePath}/objectives`,
        body: { agentId: 'agent-other' },
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
      status: 403,
      code: 'agent_not_owned',
    });
    expect(
      (
        await controller.handle({
          method: 'POST',
          path: `${basePath}/reactive-commands`,
          body: {
            agentId: 'agent-owned',
            consentPolicyVersion: 'participant-data-consent-v1',
          },
          principal: { subjectId: 'participant-7', roles: ['participant'] },
        })
      ).status,
    ).toBe(202);
  });

  test('reserves runtime mutations for operators while retaining public reads', async () => {
    const controller = createController({});
    const publicRead = await controller.handle({ method: 'GET', path: '/runtime/status' });
    expect(publicRead.status).toBe(202);

    await expectStatus(controller.handle, {
      request: {
        method: 'POST',
        path: '/runtime/run',
        body: { cycleCount: 1 },
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
      status: 403,
      code: 'insufficient_role',
    });
    expect(
      (
        await controller.handle({
          method: 'POST',
          path: '/runtime/run',
          body: { cycleCount: 1 },
          principal: { subjectId: 'operator-1', roles: ['operator'] },
        })
      ).status,
    ).toBe(202);
  });

  test('rate limits authenticated mutation bursts per principal and category', async () => {
    const controller = createController({ maximum: 16 });

    for (let index = 0; index < 4; index += 1) {
      const response = await controller.handle({
        method: 'POST',
        path: `${basePath}/agents`,
        body: {
          agentId: `agent-${index}`,
          displayName: `Agent ${index}`,
          issuedAt: index,
          consentPolicyVersion: 'participant-data-consent-v1',
        },
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      });
      expect(response.status).toBe(202);
    }
    await expectStatus(controller.handle, {
      request: {
        method: 'POST',
        path: `${basePath}/agents`,
        body: {
          agentId: 'agent-rate-limited',
          displayName: 'Rate Limited',
          issuedAt: 5,
          consentPolicyVersion: 'participant-data-consent-v1',
        },
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
      status: 429,
      code: 'participant_rate_limit_reached',
    });
  });

  test('exposes non-secret session policy and preserves explicit local open mode', async () => {
    const authenticated = createController({});
    const session = await authenticated.handle({
      method: 'GET',
      path: '/access/session',
      principal: { subjectId: 'participant-7', roles: ['participant'] },
    });
    expect(session.body).toMatchObject({
      policy: {
        policyVersion: 'participant-access-control-v2',
        consentPolicyVersion: 'participant-data-consent-v1',
        mode: 'authenticated',
        credentialMaterialInManifest: false,
      },
      authentication: {
        authenticated: true,
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
    });

    const forwarded: TownHttpApiRequest[] = [];
    const open = createTownParticipantAccessController({
      next: (request) => {
        forwarded.push(request);
        return Promise.resolve({ status: 202, headers: {}, body: request.body });
      },
      policy: createTownParticipantAccessPolicy({ mode: 'open' }),
      ownership: createOwnership(),
    });
    const response = await open.handle({
      method: 'POST',
      path: `${basePath}/agents`,
      body: {
        agentId: 'local',
        creatorId: 'local-label',
        humanAttribution: { principalSubjectId: 'spoofed' },
        consentPolicyVersion: 'spoofed',
      },
    });
    expect(response.status).toBe(202);
    expect(forwarded[0]?.body).toEqual({ agentId: 'local', creatorId: 'local-label' });
  });
});

function createController(input: {
  readonly owners?: Readonly<Record<string, string>>;
  readonly countByOwner?: Readonly<Record<string, number>>;
  readonly maximum?: number;
  readonly forwarded?: TownHttpApiRequest[];
}) {
  return createTownParticipantAccessController({
    next: (request) => {
      input.forwarded?.push(request);
      return Promise.resolve({ status: 202, headers: {}, body: request.body });
    },
    policy: createTownParticipantAccessPolicy({
      mode: 'authenticated',
      maxAgentsPerParticipant: input.maximum ?? 16,
    }),
    ownership: createOwnership(input.owners, input.countByOwner),
    rateLimits: createInMemoryParticipantMutationRateLimitPort(),
  });
}

function createOwnership(
  owners: Readonly<Record<string, string>> = {},
  countByOwner: Readonly<Record<string, number>> = {},
): TownParticipantAccessOwnershipPort {
  return {
    getAgentOwner: (input) => Promise.resolve(owners[input.agentId]),
    countOwnedAgents: (input) => Promise.resolve(countByOwner[input.ownerId] ?? 0),
  };
}

async function expectStatus(
  handle: (request: TownHttpApiRequest) => Promise<unknown>,
  input: {
    readonly request: TownHttpApiRequest;
    readonly status: number;
    readonly code: string;
  },
): Promise<void> {
  await expect(handle(input.request)).resolves.toMatchObject({
    status: input.status,
    body: { error: { code: input.code } },
  });
}

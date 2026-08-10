import { describe, expect, test } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import {
  createTownOidcJwksAuthenticator,
  createTownStaticBearerAuthenticator,
  validateTownOidcJwksAuthenticatorConfig,
} from './httpAuthentication';

const participantToken = 'participant-token-0000000000000000000001';

describe('town HTTP authentication', () => {
  test('authenticates a static Bearer credential without exposing token material', async () => {
    const authenticator = createTownStaticBearerAuthenticator({
      credentials: [
        {
          keyId: 'participant-primary',
          subjectId: 'participant-7',
          token: participantToken,
          roles: ['participant'],
        },
      ],
    });

    expect(
      await authenticator.authenticate({
        method: 'POST',
        path: '/simulations/sim-1/partitions/world-main/agents',
        headers: { authorization: `Bearer ${participantToken}` },
      }),
    ).toEqual({
      status: 'authenticated',
      principal: { subjectId: 'participant-7', roles: ['participant'] },
    });
    expect(
      await authenticator.authenticate({
        method: 'GET',
        path: '/access/session',
        headers: {},
      }),
    ).toEqual({ status: 'anonymous' });
  });

  test('rejects malformed and unknown credentials', async () => {
    const authenticator = createTownStaticBearerAuthenticator({
      credentials: [
        {
          keyId: 'participant-primary',
          subjectId: 'participant-7',
          token: participantToken,
          roles: ['participant'],
        },
      ],
    });

    expect(
      await authenticator.authenticate({
        method: 'GET',
        path: '/access/session',
        headers: { authorization: 'Basic abc' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'invalid_authorization_header' });
    expect(
      await authenticator.authenticate({
        method: 'GET',
        path: '/access/session',
        headers: { authorization: 'Bearer unknown-token-000000000000000000000000' },
      }),
    ).toMatchObject({ status: 'rejected', code: 'invalid_access_token' });
  });

  test('validates credential identity, roles, token strength, and uniqueness', () => {
    expect(() =>
      createTownStaticBearerAuthenticator({
        credentials: [
          {
            keyId: 'weak',
            subjectId: 'participant-7',
            token: 'too-short',
            roles: ['participant'],
          },
        ],
      }),
    ).toThrow('at least 32 characters');

    expect(() =>
      createTownStaticBearerAuthenticator({
        credentials: [
          {
            keyId: 'same',
            subjectId: 'participant-7',
            token: participantToken,
            roles: ['participant'],
          },
          {
            keyId: 'same',
            subjectId: 'operator-1',
            token: 'operator-token-000000000000000000000001',
            roles: ['operator'],
          },
        ],
      }),
    ).toThrow('duplicate credential keyId');
  });

  test('verifies OIDC issuer, audience, expiry, signature and mapped roles', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const keyResolver = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: 'primary', alg: 'RS256' }],
    });
    const config = {
      policyVersion: 'oidc-jwks-authentication-v1',
      issuer: 'https://identity.example.test/',
      audience: 'aivilization-town',
      jwksUrl: 'https://identity.example.test/.well-known/jwks.json',
      roleClaim: 'town_roles',
      roleValues: {
        participant: ['town-participant'],
        operator: ['town-operator'],
      },
      allowedAlgorithms: ['RS256'],
      clockToleranceSeconds: 0,
    } as const;
    const now = Math.floor(Date.now() / 1_000);
    const token = await new SignJWT({ town_roles: ['town-participant'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'primary' })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject('external-account-7')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    const authenticator = createTownOidcJwksAuthenticator({ config, keyResolver });

    await expect(
      authenticator.authenticate({
        method: 'POST',
        path: '/simulations/sim-1/partitions/world-main/agents',
        headers: { authorization: `Bearer ${token}` },
      }),
    ).resolves.toEqual({
      status: 'authenticated',
      principal: { subjectId: 'external-account-7', roles: ['participant'] },
    });
    const wrongAudience = await new SignJWT({ town_roles: ['town-participant'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'primary' })
      .setIssuer(config.issuer)
      .setAudience('another-service')
      .setSubject('external-account-7')
      .setExpirationTime(now + 300)
      .sign(privateKey);
    await expect(
      authenticator.authenticate({
        method: 'GET',
        path: '/access/session',
        headers: { authorization: `Bearer ${wrongAudience}` },
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'invalid_access_token' });
  });

  test('rejects insecure OIDC metadata and symmetric algorithms', () => {
    const base = {
      policyVersion: 'oidc-jwks-authentication-v1',
      issuer: 'https://identity.example.test/',
      audience: 'aivilization-town',
      jwksUrl: 'https://identity.example.test/.well-known/jwks.json',
      roleClaim: 'roles',
      roleValues: {
        participant: ['town-participant'],
        operator: ['town-operator'],
      },
      allowedAlgorithms: ['RS256'],
      clockToleranceSeconds: 5,
    } as const;

    expect(() =>
      validateTownOidcJwksAuthenticatorConfig({ ...base, issuer: 'http://identity.example.test/' }),
    ).toThrow('OIDC issuer must use HTTPS');
    expect(() =>
      validateTownOidcJwksAuthenticatorConfig({ ...base, allowedAlgorithms: ['HS256'] }),
    ).toThrow('unsupported algorithm HS256');
    expect(() =>
      validateTownOidcJwksAuthenticatorConfig({
        ...base,
        jwksUrl: 'https://user:secret@identity.example.test/jwks',
      }),
    ).toThrow('must not contain embedded credentials');
  });
});

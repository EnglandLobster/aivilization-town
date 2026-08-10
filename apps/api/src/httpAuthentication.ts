import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type TownAccessRole = 'participant' | 'operator';

export type TownAuthenticatedPrincipal = {
  readonly subjectId: string;
  readonly roles: readonly TownAccessRole[];
};

export type TownNodeHttpAuthenticationRequest = {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
};

export type TownNodeHttpAuthenticationResult =
  | { readonly status: 'anonymous' }
  | {
      readonly status: 'authenticated';
      readonly principal: TownAuthenticatedPrincipal;
    }
  | {
      readonly status: 'rejected';
      readonly code: 'invalid_authorization_header' | 'invalid_access_token';
      readonly message: string;
    };

export type TownNodeHttpAuthenticator = {
  readonly authenticate: (
    request: TownNodeHttpAuthenticationRequest,
  ) => TownNodeHttpAuthenticationResult | Promise<TownNodeHttpAuthenticationResult>;
};

export type TownStaticBearerCredential = {
  readonly keyId: string;
  readonly subjectId: string;
  readonly token: string;
  readonly roles: readonly TownAccessRole[];
};

export type TownStaticBearerCredentialDigest = Omit<TownStaticBearerCredential, 'token'> & {
  readonly tokenSha256: string;
};

export const TOWN_OIDC_JWKS_AUTHENTICATION_POLICY_VERSION = 'oidc-jwks-authentication-v1';

export type TownOidcJwksAuthenticatorConfig = {
  readonly policyVersion: typeof TOWN_OIDC_JWKS_AUTHENTICATION_POLICY_VERSION;
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly roleClaim: string;
  readonly roleValues: {
    readonly participant: readonly string[];
    readonly operator: readonly string[];
  };
  readonly allowedAlgorithms: readonly string[];
  readonly clockToleranceSeconds: number;
};

type IndexedCredential = Omit<TownStaticBearerCredential, 'token'> & {
  readonly tokenDigest: Buffer;
};

const MINIMUM_BEARER_TOKEN_LENGTH = 32;
const SUPPORTED_OIDC_ASYMMETRIC_ALGORITHMS = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]);

/**
 * Creates a deterministic bearer-token verifier for small self-hosted deployments.
 * Only SHA-256 digests are retained after construction. The authenticator boundary is
 * intentionally replaceable by an external identity provider without changing routing.
 */
export function createTownStaticBearerAuthenticator(input: {
  readonly credentials: readonly TownStaticBearerCredential[];
}): TownNodeHttpAuthenticator {
  return createTownStaticBearerAuthenticatorFromDigests({
    credentials: input.credentials.map(createTownStaticBearerCredentialDigest),
  });
}

export function createTownStaticBearerCredentialDigest(
  value: TownStaticBearerCredential,
): TownStaticBearerCredentialDigest {
  const [indexed] = indexCredentials([value]);
  if (indexed === undefined) {
    throw new Error('credential could not be indexed');
  }
  return {
    keyId: indexed.keyId,
    subjectId: indexed.subjectId,
    roles: [...indexed.roles],
    tokenSha256: indexed.tokenDigest.toString('hex'),
  };
}

export function createTownStaticBearerAuthenticatorFromDigests(input: {
  readonly credentials: readonly TownStaticBearerCredentialDigest[];
}): TownNodeHttpAuthenticator {
  const credentials = indexCredentialDigests(input.credentials);
  return {
    authenticate: (request) => {
      const bearer = parseBearerToken(request.headers.authorization);
      if (bearer.status !== 'token') return bearer.result;
      const presentedDigest = digestToken(bearer.token);
      let credential: IndexedCredential | undefined;
      for (const candidate of credentials) {
        const matches = timingSafeEqual(candidate.tokenDigest, presentedDigest);
        if (matches && credential === undefined) {
          credential = candidate;
        }
      }
      if (credential === undefined) {
        return {
          status: 'rejected',
          code: 'invalid_access_token',
          message: 'access token is invalid',
        };
      }
      return {
        status: 'authenticated',
        principal: {
          subjectId: credential.subjectId,
          roles: [...credential.roles],
        },
      };
    },
  };
}

export function createTownOidcJwksAuthenticator(input: {
  readonly config: TownOidcJwksAuthenticatorConfig;
  readonly keyResolver?: JWTVerifyGetKey;
}): TownNodeHttpAuthenticator {
  const config = validateTownOidcJwksAuthenticatorConfig(input.config);
  const keyResolver =
    input.keyResolver ??
    createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  return {
    authenticate: async (request) => {
      const bearer = parseBearerToken(request.headers.authorization);
      if (bearer.status !== 'token') return bearer.result;
      try {
        const verified = await jwtVerify(bearer.token, keyResolver, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: [...config.allowedAlgorithms],
          clockTolerance: config.clockToleranceSeconds,
          requiredClaims: ['sub', 'exp'],
        });
        const subjectId = requireNonEmptyClaim(verified.payload.sub, 'sub');
        const roles = resolveOidcRoles(verified.payload[config.roleClaim], config.roleValues);
        if (roles.length === 0) {
          return {
            status: 'rejected',
            code: 'invalid_access_token',
            message: 'access token does not grant a supported town role',
          };
        }
        return {
          status: 'authenticated',
          principal: { subjectId, roles },
        };
      } catch {
        return {
          status: 'rejected',
          code: 'invalid_access_token',
          message: 'access token failed OIDC verification',
        };
      }
    },
  };
}

export function validateTownOidcJwksAuthenticatorConfig(
  value: TownOidcJwksAuthenticatorConfig,
): TownOidcJwksAuthenticatorConfig {
  if (value.policyVersion !== TOWN_OIDC_JWKS_AUTHENTICATION_POLICY_VERSION) {
    throw new Error('OIDC policyVersion must equal oidc-jwks-authentication-v1');
  }
  const issuer = requireHttpsUrl(value.issuer, 'OIDC issuer');
  const jwksUrl = requireHttpsUrl(value.jwksUrl, 'OIDC jwksUrl');
  const audience = requireNonEmpty(value.audience, 'OIDC audience');
  const roleClaim = requireNonEmpty(value.roleClaim, 'OIDC roleClaim');
  const participantRoleValues = normalizeClaimValues(
    value.roleValues.participant,
    'OIDC participant role values',
  );
  const operatorRoleValues = normalizeClaimValues(
    value.roleValues.operator,
    'OIDC operator role values',
  );
  const overlap = participantRoleValues.find((entry) => operatorRoleValues.includes(entry));
  if (overlap !== undefined) {
    throw new Error(`OIDC role value ${overlap} cannot grant both participant and operator`);
  }
  const allowedAlgorithms = normalizeClaimValues(value.allowedAlgorithms, 'OIDC allowedAlgorithms');
  const unsupportedAlgorithm = allowedAlgorithms.find(
    (algorithm) => !SUPPORTED_OIDC_ASYMMETRIC_ALGORITHMS.has(algorithm),
  );
  if (unsupportedAlgorithm !== undefined) {
    throw new Error(
      `OIDC allowedAlgorithms contains unsupported algorithm ${unsupportedAlgorithm}`,
    );
  }
  if (!Number.isFinite(value.clockToleranceSeconds) || value.clockToleranceSeconds < 0) {
    throw new Error('OIDC clockToleranceSeconds must be a non-negative finite number');
  }
  return {
    policyVersion: TOWN_OIDC_JWKS_AUTHENTICATION_POLICY_VERSION,
    issuer,
    audience,
    jwksUrl,
    roleClaim,
    roleValues: {
      participant: participantRoleValues,
      operator: operatorRoleValues,
    },
    allowedAlgorithms,
    clockToleranceSeconds: value.clockToleranceSeconds,
  };
}

function indexCredentialDigests(
  values: readonly TownStaticBearerCredentialDigest[],
): readonly IndexedCredential[] {
  if (values.length === 0) {
    throw new Error('credentials must contain at least one entry');
  }
  const keyIds = new Set<string>();
  const tokenDigests = new Set<string>();
  return values.map((value, index) => {
    const keyId = requireNonEmpty(value.keyId, `credentials[${index}].keyId`);
    const subjectId = requireNonEmpty(value.subjectId, `credentials[${index}].subjectId`);
    if (keyIds.has(keyId)) {
      throw new Error(`duplicate credential keyId: ${keyId}`);
    }
    keyIds.add(keyId);
    const roles = normalizeRoles(value.roles, index);
    if (!/^[a-f0-9]{64}$/u.test(value.tokenSha256)) {
      throw new Error(`credentials[${index}].tokenSha256 must be a lowercase SHA-256 digest`);
    }
    if (tokenDigests.has(value.tokenSha256)) {
      throw new Error('credential token digests must be unique');
    }
    tokenDigests.add(value.tokenSha256);
    return {
      keyId,
      subjectId,
      roles,
      tokenDigest: Buffer.from(value.tokenSha256, 'hex'),
    };
  });
}

function indexCredentials(
  values: readonly TownStaticBearerCredential[],
): readonly IndexedCredential[] {
  if (values.length === 0) {
    throw new Error('credentials must contain at least one entry');
  }
  const keyIds = new Set<string>();
  const tokenDigests = new Set<string>();
  return values.map((value, index) => {
    const keyId = requireNonEmpty(value.keyId, `credentials[${index}].keyId`);
    const subjectId = requireNonEmpty(value.subjectId, `credentials[${index}].subjectId`);
    if (keyIds.has(keyId)) {
      throw new Error(`duplicate credential keyId: ${keyId}`);
    }
    keyIds.add(keyId);
    if (value.token.length < MINIMUM_BEARER_TOKEN_LENGTH) {
      throw new Error(
        `credentials[${index}].token must contain at least ${MINIMUM_BEARER_TOKEN_LENGTH} characters`,
      );
    }
    const roles = normalizeRoles(value.roles, index);
    const tokenDigest = digestToken(value.token);
    const digestHex = tokenDigest.toString('hex');
    if (tokenDigests.has(digestHex)) {
      throw new Error('credential tokens must be unique');
    }
    tokenDigests.add(digestHex);
    return { keyId, subjectId, roles, tokenDigest };
  });
}

function normalizeRoles(
  values: readonly TownAccessRole[],
  index: number,
): readonly TownAccessRole[] {
  const roles = [...new Set(values)].sort();
  if (roles.length === 0) {
    throw new Error(`credentials[${index}].roles must contain at least one role`);
  }
  for (const role of roles) {
    if (role !== 'participant' && role !== 'operator') {
      throw new Error(`credentials[${index}].roles contains unsupported role ${String(role)}`);
    }
  }
  return roles;
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function parseBearerToken(authorization: string | readonly string[] | undefined):
  | { readonly status: 'token'; readonly token: string }
  | {
      readonly status: 'result';
      readonly result: TownNodeHttpAuthenticationResult;
    } {
  if (authorization === undefined) {
    return { status: 'result', result: { status: 'anonymous' } };
  }
  if (typeof authorization !== 'string') {
    return {
      status: 'result',
      result: {
        status: 'rejected',
        code: 'invalid_authorization_header',
        message: 'authorization header must contain exactly one Bearer credential',
      },
    };
  }
  const match = /^Bearer ([^\s]+)$/iu.exec(authorization.trim());
  if (match === null || match[1] === undefined) {
    return {
      status: 'result',
      result: {
        status: 'rejected',
        code: 'invalid_authorization_header',
        message: 'authorization header must use the Bearer scheme',
      },
    };
  }
  return { status: 'token', token: match[1] };
}

function resolveOidcRoles(
  claim: unknown,
  roleValues: TownOidcJwksAuthenticatorConfig['roleValues'],
): readonly TownAccessRole[] {
  const presented = new Set(
    typeof claim === 'string'
      ? claim.split(/\s+/u).filter((entry) => entry.length > 0)
      : Array.isArray(claim)
        ? claim.filter((entry): entry is string => typeof entry === 'string')
        : [],
  );
  const roles: TownAccessRole[] = [];
  if (roleValues.participant.some((entry) => presented.has(entry))) roles.push('participant');
  if (roleValues.operator.some((entry) => presented.has(entry))) roles.push('operator');
  return roles;
}

function normalizeClaimValues(values: readonly string[], name: string): readonly string[] {
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }
  return [...new Set(values.map((value) => requireNonEmpty(value, name)))].sort();
}

function requireHttpsUrl(value: string, name: string): string {
  const normalized = requireNonEmpty(value, name);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch (error) {
    throw new Error(`${name} must be an absolute URL`, { cause: error });
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`${name} must not contain embedded credentials`);
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`${name} must not contain a query or fragment`);
  }
  return url.toString();
}

function requireNonEmptyClaim(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} claim must be a string`);
  return requireNonEmpty(value, `${name} claim`);
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  return normalized;
}

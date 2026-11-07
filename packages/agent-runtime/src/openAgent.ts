export const OPEN_AGENT_POLICY_VERSION = 'open-agent-runtime-v1';
export const OPEN_AGENT_CONTEXT_VERSION = 'open-agent-context-v1';
export type OpenAgentPolicy = {
  readonly version: typeof OPEN_AGENT_POLICY_VERSION;
  readonly contextVersion: typeof OPEN_AGENT_CONTEXT_VERSION;
  readonly maxCallsPerTurn: number;
  readonly maxQueryItems: number;
  readonly contextCognition: number;
  readonly contextMemories: number;
  readonly contextMessages: number;
  readonly contextPeople: number;
  readonly maxResultChars: number;
  readonly freeActivityIntervalMs: number;
  /** Simulation time charged at opportunity boundaries; absent v1 manifests use 1000 ms. */
  readonly opportunityCadenceMs?: number;
  /** Absent: every direct message wakes its recipient immediately (historical behavior). */
  readonly messageWake?: OpenAgentMessageWakePolicy;
  /** Absent: residents cannot queue their own actions; every step needs a new opportunity. */
  readonly actionPlans?: OpenAgentActionPlansPolicy;
};
/**
 * Residents may queue a short sequence of their own actions that the world carries out in order
 * without a new model opportunity per step; they are woken when it finishes, a step is refused,
 * or a paced message arrives. Each step is still an ordinary authorized capability call.
 */
export type OpenAgentActionPlansPolicy = {
  readonly version: 'resident-action-plans-v1' | 'resident-action-plans-v2';
  readonly maxSteps: number;
};
export const RESIDENT_ACTION_PLANS_POLICY: OpenAgentActionPlansPolicy = {
  version: 'resident-action-plans-v1',
  maxSteps: 8,
};
/** v1 plus using goods you own (`life consume`), which v1 left out. */
export const RESIDENT_ACTION_PLANS_POLICY_V2: OpenAgentActionPlansPolicy = {
  version: 'resident-action-plans-v2',
  maxSteps: 8,
};
/**
 * Attention pacing for direct messages. People notice messages when they finish what they are
 * doing and do not answer every message the instant it arrives; residents can still choose a
 * nearer `schedule wait` themselves when they want a reply sooner.
 */
export type OpenAgentMessageWakePolicy = {
  readonly version: 'resident-message-pacing-v1';
  /** A message-triggered wake is never sooner than this after the start of the last opportunity. */
  readonly minIntervalMs: number;
  /** Messages do not interrupt an ongoing activity or journey; they wait until it ends. */
  readonly deferDuringActivity: boolean;
};
export const RESIDENT_MESSAGE_PACING_POLICY: OpenAgentMessageWakePolicy = {
  version: 'resident-message-pacing-v1',
  minIntervalMs: 1_800_000,
  deferDuringActivity: true,
};
export const DEFAULT_OPEN_AGENT_POLICY: OpenAgentPolicy = {
  version: OPEN_AGENT_POLICY_VERSION,
  contextVersion: OPEN_AGENT_CONTEXT_VERSION,
  maxCallsPerTurn: 40,
  maxQueryItems: 30,
  contextCognition: 8,
  contextMemories: 6,
  contextMessages: 6,
  contextPeople: 12,
  maxResultChars: 24_000,
  freeActivityIntervalMs: 3_600_000,
  opportunityCadenceMs: 1000,
};
export function assertOpenAgentPolicy(policy: OpenAgentPolicy): void {
  if (
    policy.version !== OPEN_AGENT_POLICY_VERSION ||
    policy.contextVersion !== OPEN_AGENT_CONTEXT_VERSION ||
    [
      policy.maxCallsPerTurn,
      policy.maxQueryItems,
      policy.contextCognition,
      policy.contextMemories,
      policy.contextMessages,
      policy.contextPeople,
      policy.maxResultChars,
      policy.freeActivityIntervalMs,
      policy.opportunityCadenceMs ?? 1000,
    ].some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) ||
    (policy.messageWake !== undefined &&
      (policy.messageWake.version !== 'resident-message-pacing-v1' ||
        !Number.isSafeInteger(policy.messageWake.minIntervalMs) ||
        policy.messageWake.minIntervalMs < 0 ||
        policy.messageWake.minIntervalMs > 86_400_000 ||
        typeof policy.messageWake.deferDuringActivity !== 'boolean')) ||
    (policy.actionPlans !== undefined &&
      ((policy.actionPlans.version !== 'resident-action-plans-v1' &&
        policy.actionPlans.version !== 'resident-action-plans-v2') ||
        !Number.isSafeInteger(policy.actionPlans.maxSteps) ||
        policy.actionPlans.maxSteps < 1 ||
        policy.actionPlans.maxSteps > 16))
  )
    throw new Error('invalid-open-agent-policy');
}
export type OpenToolProperty = {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly items?: { readonly type: 'string' };
};
export type OpenToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly mutates: boolean;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, OpenToolProperty>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
};
export type OpenToolResult = {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly revision: number;
  readonly simulationTime: number;
};
export type OpenToolRequest = {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly requestId: string;
};
/** Reject unknown keys: runtime authority fields are never accepted from model payloads. */
export function validateOpenToolArguments(
  definition: OpenToolDefinition,
  value: unknown,
): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return 'arguments-must-be-object';
  const record = value as Record<string, unknown>;
  for (const required of definition.inputSchema.required)
    if (!Object.hasOwn(record, required)) return `missing-argument:${required}`;
  for (const [key, item] of Object.entries(record)) {
    const property = definition.inputSchema.properties[key];
    if (property === undefined) return `unknown-argument:${key}`;
    const type = property.type;
    if (type === 'array') {
      if (
        !Array.isArray(item) ||
        item.length > 100 ||
        item.some((entry: unknown) => typeof entry !== 'string')
      )
        return `invalid-array:${key}`;
      if (item.length < (property.minItems ?? 0)) return `array-too-short:${key}`;
      if (item.length > (property.maxItems ?? 100)) return `array-too-long:${key}`;
    } else if (type === 'object') {
      if (item === null || typeof item !== 'object' || Array.isArray(item))
        return `invalid-object:${key}`;
    } else if (type === 'number' || type === 'integer') {
      if (
        typeof item !== 'number' ||
        !Number.isFinite(item) ||
        (type === 'integer' && !Number.isSafeInteger(item)) ||
        (property.minimum !== undefined && item < property.minimum) ||
        (property.maximum !== undefined && item > property.maximum)
      )
        return `invalid-number:${key}`;
    } else if (typeof item !== type) return `invalid-${type}:${key}`;
    if (
      typeof item === 'string' &&
      (item.length > (property.maxLength ?? 8000) ||
        (property.enum !== undefined && !property.enum.includes(item)))
    )
      return `invalid-string:${key}`;
  }
  return undefined;
}

/** A provider owns exploration; the runtime owns identity, persistence, budgets and world effects. */
export type OpenAgentDriver = {
  readonly id: string;
  run(input: {
    readonly actorId: string;
    readonly turnId: string;
    readonly context: unknown;
    readonly signal: AbortSignal;
    readonly invoke: (request: OpenToolRequest) => Promise<OpenToolResult>;
  }): Promise<{
    readonly status: 'completed' | 'provider-error';
    readonly sessionId?: string;
    readonly summary: string;
    readonly usage?: unknown;
  }>;
};

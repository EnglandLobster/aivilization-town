import { readFile } from 'node:fs/promises';
import type {
  AdaptiveReplanningPolicy,
  ReactiveActionSimulator,
} from '@aivilization/agent-runtime';
import type {
  LlmGatewayPricing,
  LlmProviderCompletionRequest,
  LlmProviderCompletionResponse,
  LlmProviderFinishReason,
  LlmStructuredProviderConfig,
  OpenAiCompatibleResponseFormatMode,
  ScriptedLlmProviderResponse,
} from '@aivilization/llm';
import { asAgentId, asCommandId, asEventId, type CoreCommandType } from '@aivilization/sim-core';
import {
  createShortTermMemoryRecord,
  type MemoryConsolidationHint,
  type MemorySource,
  type ShortTermMemoryKind,
  type ShortTermMemoryRecord,
  type ShortTermMemoryStatus,
} from '@aivilization/memory';
import type {
  CanonicalDomainRuntimeConfig,
  LocalSimulationLifecycleMemoryConsolidationSchedule,
  WorldStateActionSynthesisPolicyConfig,
} from '@aivilization/worker';
import type {
  LocalRuntimeTownProfileDailyCompilerConfig,
  LocalRuntimeTownProfileDailyPlanningConfig,
  LocalRuntimeTownProfileActionSequenceGenerationConfig,
  LocalRuntimeTownProfileActionSequenceGeneratorConfig,
  LocalRuntimeTownProfileGlobalSynthesisConfig,
  LocalRuntimeTownProfileGlobalSynthesizerConfig,
  LocalRuntimeTownProfileLlmPlanningConfig,
  LocalRuntimeTownProfileReactiveCorrectionConfig,
  LocalRuntimeTownProfileReactiveCorrectorConfig,
  LocalRuntimeTownProfileReplanningDecisionConfig,
  LocalRuntimeTownProfileReplanningDeciderConfig,
  LocalRuntimeTownProfileReactionEvaluatorConfig,
  LocalRuntimeTownProfileReactionPlanningConfig,
  LocalRuntimeTownProfileReflectionSynthesisConfig,
  LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig,
  LocalRuntimeTownProfileSocialDialogueGenerationConfig,
  LocalRuntimeTownProfileSocialDialogueGeneratorConfig,
  LocalRuntimeTownProfileSocialModelSynthesisConfig,
  LocalRuntimeTownProfileSocialModelSynthesizerConfig,
  LocalRuntimeTownProfileSubtaskPrioritizationConfig,
  LocalRuntimeTownProfileSubtaskPrioritizerConfig,
  LocalRuntimeTownProfileStrategicCompilerConfig,
} from './localRuntimeTownProfileLlmPlanning';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileRuntimeConfigSecretReference = {
  readonly env: string;
};

export type LocalRuntimeTownProfileRuntimeConfigSecretValue =
  | string
  | LocalRuntimeTownProfileRuntimeConfigSecretReference;

export type LocalRuntimeTownProfileRuntimeConfigReadTextFile = (path: string) => Promise<string>;

export type LocalRuntimeTownProfileLlmPlanningConfigLoadInput = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly path: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readTextFile?: LocalRuntimeTownProfileRuntimeConfigReadTextFile;
};

export type LocalRuntimeTownProfileRuntimeConfigLoadInput =
  LocalRuntimeTownProfileLlmPlanningConfigLoadInput;

export type LocalRuntimeTownProfilePaperAlignmentConfig = {
  readonly minimumLocalRepairAcceptedCount?: number;
};

export type LocalRuntimeTownProfileShortTermMemorySeed = {
  readonly record: ShortTermMemoryRecord;
  readonly replicateToProfileAgents: boolean;
};

export type LocalRuntimeTownProfileRuntimeConfig = {
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly actionSynthesis?: WorldStateActionSynthesisPolicyConfig | false;
  readonly paperAlignment?: LocalRuntimeTownProfilePaperAlignmentConfig;
  readonly shortTermMemorySeeds?: readonly LocalRuntimeTownProfileShortTermMemorySeed[];
  readonly strategicPlanning?: LocalRuntimeTownProfileLlmPlanningConfig;
  readonly dailyPlanning?: LocalRuntimeTownProfileDailyPlanningConfig;
  readonly reactionPlanning?: LocalRuntimeTownProfileReactionPlanningConfig;
  readonly subtaskPrioritization?: LocalRuntimeTownProfileSubtaskPrioritizationConfig;
  readonly actionSequenceGeneration?: LocalRuntimeTownProfileActionSequenceGenerationConfig;
  readonly socialDialogue?: LocalRuntimeTownProfileSocialDialogueGenerationConfig;
  readonly globalSynthesis?: LocalRuntimeTownProfileGlobalSynthesisConfig;
  readonly reactiveCorrection?: LocalRuntimeTownProfileReactiveCorrectionConfig;
  readonly replanningDecision?: LocalRuntimeTownProfileReplanningDecisionConfig;
  readonly reflectionSynthesis?: LocalRuntimeTownProfileReflectionSynthesisConfig;
  readonly socialModelSynthesis?: LocalRuntimeTownProfileSocialModelSynthesisConfig;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly memoryConsolidationSchedule?: LocalSimulationLifecycleMemoryConsolidationSchedule;
  readonly steeringSimulator?: ReactiveActionSimulator;
};

const CORE_COMMAND_TYPES = [
  'AgentProduce',
  'AgentTrade',
  'AgentEat',
  'AgentMoveTo',
  'AgentObserveLocation',
  'AgentStartConversation',
  'AgentSleep',
  'AgentSeeDoctor',
  'AgentStudy',
  'AgentApplyJob',
  'AgentUpgradeResidentialTier',
  'AgentWork',
  'AgentSocialize',
  'SetLongHorizonObjective',
  'IssueReactiveCommand',
  'AdvanceSimulationTime',
] as const satisfies readonly CoreCommandType[];

const SHORT_TERM_MEMORY_KINDS = [
  'action',
  'observation',
  'social-interaction',
  'human-command',
] as const satisfies readonly ShortTermMemoryKind[];

const SHORT_TERM_MEMORY_STATUSES = [
  'succeeded',
  'failed',
  'repaired',
  'observed',
] as const satisfies readonly ShortTermMemoryStatus[];

export async function loadLocalRuntimeTownProfileLlmPlanningConfig(
  input: LocalRuntimeTownProfileLlmPlanningConfigLoadInput,
): Promise<LocalRuntimeTownProfileStrategicCompilerConfig> {
  assertNonEmpty(input.path, 'path');
  const readTextFile = input.readTextFile ?? readTextFileFromDisk;
  const text = await readTextFile(input.path);
  const document = parseJsonObject(text, input.path);

  return parseLocalRuntimeTownProfileLlmPlanningConfigDocument({
    profileId: input.profileId,
    document,
    env: input.env ?? {},
  });
}

export async function loadLocalRuntimeTownProfileRuntimeConfig(
  input: LocalRuntimeTownProfileRuntimeConfigLoadInput,
): Promise<LocalRuntimeTownProfileRuntimeConfig> {
  assertNonEmpty(input.path, 'path');
  const readTextFile = input.readTextFile ?? readTextFileFromDisk;
  const text = await readTextFile(input.path);
  const document = parseJsonObject(text, input.path);

  return parseLocalRuntimeTownProfileRuntimeConfigDocument({
    profileId: input.profileId,
    document,
    env: input.env ?? {},
  });
}

export function parseLocalRuntimeTownProfileLlmPlanningConfigDocument(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly document: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileStrategicCompilerConfig {
  const document = requireRecord(input.document, 'runtime profile config document');
  const selectedNode = selectProfileLlmPlanningNode(document, input.profileId);
  return parseLlmPlanningNode({
    profileId: input.profileId,
    node: selectedNode,
    env: input.env ?? {},
  });
}

export function parseLocalRuntimeTownProfileRuntimeConfigDocument(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly document: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileRuntimeConfig {
  const document = requireRecord(input.document, 'runtime profile config document');
  const env = input.env ?? {};
  const domainConfig = parseDomainConfigNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'domainConfig',
    }),
  });
  const actionSynthesis = parseActionSynthesisNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'actionSynthesis',
    }),
  });
  const paperAlignment = parsePaperAlignmentNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'paperAlignment',
    }),
  });
  const shortTermMemorySeeds = parseShortTermMemorySeedsNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'shortTermMemorySeeds',
    }),
  });
  const strategicPlanning = parseLlmPlanningNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'llmPlanning',
    }),
    env,
  });
  const dailyPlanning = parseDailyPlanningNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'dailyPlanning',
    }),
    env,
  });
  const reactionPlanning = parseReactionPlanningNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'reactionPlanning',
    }),
    env,
  });
  const replanningPolicy = parseReplanningPolicyNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'replanningPolicy',
    }),
  });
  const subtaskPrioritization = parseSubtaskPrioritizationNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'subtaskPrioritization',
    }),
    env,
  });
  const actionSequenceGeneration = parseActionSequenceGenerationNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'actionSequenceGeneration',
    }),
    env,
  });
  const globalSynthesis = parseGlobalSynthesisNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'globalSynthesis',
    }),
    env,
  });
  const socialDialogue = parseSocialDialogueNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'socialDialogue',
    }),
    env,
  });
  const reactiveCorrection = parseReactiveCorrectionNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'reactiveCorrection',
    }),
    env,
  });
  const replanningDecision = parseReplanningDecisionNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'replanningDecision',
    }),
    env,
  });
  const reflectionSynthesis = parseReflectionSynthesisNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'reflectionSynthesis',
    }),
    env,
  });
  const socialModelSynthesis = parseSocialModelSynthesisNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'socialModelSynthesis',
    }),
    env,
  });
  const memoryConsolidationSchedule = parseMemoryConsolidationScheduleNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'memoryConsolidationSchedule',
    }),
  });
  const steeringSimulator = parseSteeringSimulatorNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'steeringSimulator',
    }),
  });

  return {
    ...(domainConfig === undefined ? {} : { domainConfig }),
    ...(actionSynthesis === undefined ? {} : { actionSynthesis }),
    ...(paperAlignment === undefined ? {} : { paperAlignment }),
    ...(shortTermMemorySeeds === undefined ? {} : { shortTermMemorySeeds }),
    ...(strategicPlanning === undefined ? {} : { strategicPlanning }),
    ...(dailyPlanning === undefined ? {} : { dailyPlanning }),
    ...(reactionPlanning === undefined ? {} : { reactionPlanning }),
    ...(subtaskPrioritization === undefined ? {} : { subtaskPrioritization }),
    ...(actionSequenceGeneration === undefined ? {} : { actionSequenceGeneration }),
    ...(socialDialogue === undefined ? {} : { socialDialogue }),
    ...(globalSynthesis === undefined ? {} : { globalSynthesis }),
    ...(reactiveCorrection === undefined ? {} : { reactiveCorrection }),
    ...(replanningDecision === undefined ? {} : { replanningDecision }),
    ...(reflectionSynthesis === undefined ? {} : { reflectionSynthesis }),
    ...(socialModelSynthesis === undefined ? {} : { socialModelSynthesis }),
    ...(replanningPolicy === undefined ? {} : { replanningPolicy }),
    ...(memoryConsolidationSchedule === undefined ? {} : { memoryConsolidationSchedule }),
    ...(steeringSimulator === undefined ? {} : { steeringSimulator }),
  };
}

async function readTextFileFromDisk(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

function parseJsonObject(text: string, path: string): Readonly<Record<string, unknown>> {
  try {
    return requireRecord(JSON.parse(text) as unknown, `runtime profile config ${path}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`runtime profile config ${path} must be valid JSON: ${error.message}`);
    }
    throw error;
  }
}

function selectProfileLlmPlanningNode(
  document: Readonly<Record<string, unknown>>,
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): unknown {
  return selectProfilePlanningNode({ document, profileId, nodeName: 'llmPlanning' });
}

function selectProfilePlanningNode(input: {
  readonly document: Readonly<Record<string, unknown>>;
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName;
}): unknown {
  const profiles = readOptionalRecord(input.document.profiles, 'profiles');
  const profileNode = profiles?.[input.profileId];
  if (profileNode !== undefined) {
    const profile = requireRecord(profileNode, `profiles.${input.profileId}`);
    if (hasOwn(profile, input.nodeName)) {
      return profile[input.nodeName];
    }
  }

  return input.document[input.nodeName];
}

function parseLlmPlanningNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileStrategicCompilerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'llmPlanning');
  const kind = readRequiredString(record.kind, 'llmPlanning.kind');
  if (kind !== 'traceable-llm-strategic-planner') {
    throw new Error(`llmPlanning.kind must be traceable-llm-strategic-planner`);
  }

  const maxAttempts = readOptionalPositiveInteger(record.maxAttempts, 'llmPlanning.maxAttempts');
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'llmPlanning.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'llmPlanning');

  return {
    kind: 'traceable-llm-strategic-planner',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'llmPlanning.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'llmPlanning'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseDailyPlanningNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileDailyCompilerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'dailyPlanning');
  const kind = readRequiredString(record.kind, 'dailyPlanning.kind');
  if (kind !== 'traceable-llm-daily-planner') {
    throw new Error(`dailyPlanning.kind must be traceable-llm-daily-planner`);
  }

  const maxAttempts = readOptionalPositiveInteger(record.maxAttempts, 'dailyPlanning.maxAttempts');
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'dailyPlanning.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'dailyPlanning');

  return {
    kind: 'traceable-llm-daily-planner',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'dailyPlanning.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'dailyPlanning'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReactionPlanningNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileReactionEvaluatorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'reactionPlanning');
  const kind = readRequiredString(record.kind, 'reactionPlanning.kind');
  if (kind !== 'traceable-llm-reaction-evaluator') {
    throw new Error(`reactionPlanning.kind must be traceable-llm-reaction-evaluator`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'reactionPlanning.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'reactionPlanning.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'reactionPlanning');

  return {
    kind: 'traceable-llm-reaction-evaluator',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'reactionPlanning.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'reactionPlanning'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseSubtaskPrioritizationNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileSubtaskPrioritizerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'subtaskPrioritization');
  const kind = readRequiredString(record.kind, 'subtaskPrioritization.kind');
  if (kind !== 'traceable-llm-subtask-prioritizer') {
    throw new Error(`subtaskPrioritization.kind must be traceable-llm-subtask-prioritizer`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'subtaskPrioritization.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(
    record.timeoutMs,
    'subtaskPrioritization.timeoutMs',
  );
  const pricing = parseOptionalPricing(record.pricing, 'subtaskPrioritization');

  return {
    kind: 'traceable-llm-subtask-prioritizer',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'subtaskPrioritization.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'subtaskPrioritization'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseActionSequenceGenerationNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileActionSequenceGeneratorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'actionSequenceGeneration');
  const kind = readRequiredString(record.kind, 'actionSequenceGeneration.kind');
  if (kind !== 'traceable-llm-action-sequence-generator') {
    throw new Error(
      `actionSequenceGeneration.kind must be traceable-llm-action-sequence-generator`,
    );
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'actionSequenceGeneration.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(
    record.timeoutMs,
    'actionSequenceGeneration.timeoutMs',
  );
  const pricing = parseOptionalPricing(record.pricing, 'actionSequenceGeneration');

  return {
    kind: 'traceable-llm-action-sequence-generator',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'actionSequenceGeneration.model'),
    provider: parseLlmStructuredProviderConfig(
      record.provider,
      input.env,
      'actionSequenceGeneration',
    ),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseGlobalSynthesisNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileGlobalSynthesizerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'globalSynthesis');
  const kind = readRequiredString(record.kind, 'globalSynthesis.kind');
  if (kind !== 'traceable-llm-global-synthesizer') {
    throw new Error(`globalSynthesis.kind must be traceable-llm-global-synthesizer`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'globalSynthesis.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'globalSynthesis.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'globalSynthesis');

  return {
    kind: 'traceable-llm-global-synthesizer',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'globalSynthesis.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'globalSynthesis'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseSocialDialogueNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileSocialDialogueGeneratorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'socialDialogue');
  const kind = readRequiredString(record.kind, 'socialDialogue.kind');
  if (kind !== 'traceable-llm-social-dialogue-generator') {
    throw new Error(`socialDialogue.kind must be traceable-llm-social-dialogue-generator`);
  }

  const maxAttempts = readOptionalPositiveInteger(record.maxAttempts, 'socialDialogue.maxAttempts');
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'socialDialogue.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'socialDialogue');

  return {
    kind: 'traceable-llm-social-dialogue-generator',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'socialDialogue.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'socialDialogue'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReactiveCorrectionNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileReactiveCorrectorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'reactiveCorrection');
  const kind = readRequiredString(record.kind, 'reactiveCorrection.kind');
  if (kind !== 'traceable-llm-reactive-corrector') {
    throw new Error(`reactiveCorrection.kind must be traceable-llm-reactive-corrector`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'reactiveCorrection.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'reactiveCorrection.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'reactiveCorrection');

  return {
    kind: 'traceable-llm-reactive-corrector',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'reactiveCorrection.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'reactiveCorrection'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReplanningDecisionNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileReplanningDeciderConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'replanningDecision');
  const kind = readRequiredString(record.kind, 'replanningDecision.kind');
  if (kind !== 'traceable-llm-replanning-decider') {
    throw new Error(`replanningDecision.kind must be traceable-llm-replanning-decider`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'replanningDecision.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'replanningDecision.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'replanningDecision');

  return {
    kind: 'traceable-llm-replanning-decider',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'replanningDecision.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'replanningDecision'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReflectionSynthesisNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'reflectionSynthesis');
  const kind = readRequiredString(record.kind, 'reflectionSynthesis.kind');
  if (kind !== 'traceable-llm-reflective-insight-synthesizer') {
    throw new Error(
      `reflectionSynthesis.kind must be traceable-llm-reflective-insight-synthesizer`,
    );
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'reflectionSynthesis.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(
    record.timeoutMs,
    'reflectionSynthesis.timeoutMs',
  );
  const pricing = parseOptionalPricing(record.pricing, 'reflectionSynthesis');

  return {
    kind: 'traceable-llm-reflective-insight-synthesizer',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'reflectionSynthesis.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'reflectionSynthesis'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseSocialModelSynthesisNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileSocialModelSynthesizerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'socialModelSynthesis');
  const kind = readRequiredString(record.kind, 'socialModelSynthesis.kind');
  if (kind !== 'traceable-llm-social-model-synthesizer') {
    throw new Error(`socialModelSynthesis.kind must be traceable-llm-social-model-synthesizer`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'socialModelSynthesis.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(
    record.timeoutMs,
    'socialModelSynthesis.timeoutMs',
  );
  const pricing = parseOptionalPricing(record.pricing, 'socialModelSynthesis');

  return {
    kind: 'traceable-llm-social-model-synthesizer',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'socialModelSynthesis.model'),
    provider: parseLlmStructuredProviderConfig(record.provider, input.env, 'socialModelSynthesis'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReplanningPolicyNode(input: {
  readonly node: unknown;
}): AdaptiveReplanningPolicy | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'replanningPolicy');
  const failureTags = readOptionalStringArray(record.failureTags, 'replanningPolicy.failureTags');
  const majorContextShift = parseOptionalMajorContextShift(
    record.majorContextShift,
    'replanningPolicy.majorContextShift',
  );

  return {
    consecutiveFailureThreshold: readRequiredPositiveInteger(
      record.consecutiveFailureThreshold,
      'replanningPolicy.consecutiveFailureThreshold',
    ),
    ...(failureTags === undefined ? {} : { failureTags }),
    ...(majorContextShift === undefined ? {} : { majorContextShift }),
  };
}

function parseDomainConfigNode(input: {
  readonly node: unknown;
}): CanonicalDomainRuntimeConfig | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'domainConfig');
  const study = parseStudyDomainConfig(record.study);
  const work = parseWorkDomainConfig(record.work);
  const trade = parseTradeDomainConfig(record.trade);
  const sleep = parseSleepDomainConfig(record.sleep);
  const health = parseHealthDomainConfig(record.health);
  const eat = parseEatDomainConfig(record.eat);
  const social = parseSocialDomainConfig(record.social);
  const production = parseProductionDomainConfig(record.production);
  const residential = parseResidentialDomainConfig(record.residential);

  return {
    ...(study === undefined ? {} : { study }),
    ...(work === undefined ? {} : { work }),
    ...(trade === undefined ? {} : { trade }),
    ...(sleep === undefined ? {} : { sleep }),
    ...(health === undefined ? {} : { health }),
    ...(eat === undefined ? {} : { eat }),
    ...(social === undefined ? {} : { social }),
    ...(production === undefined ? {} : { production }),
    ...(residential === undefined ? {} : { residential }),
  };
}

function parseActionSynthesisNode(input: {
  readonly node: unknown;
}): WorldStateActionSynthesisPolicyConfig | false | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }
  if (input.node === false) {
    return false;
  }

  const record = requireRecord(input.node, 'actionSynthesis');
  const maxActions = readOptionalNonNegativeInteger(
    record.maxActions,
    'actionSynthesis.maxActions',
  );
  const planningWindowSeconds = readOptionalNonNegativeFinite(
    record.planningWindowSeconds,
    'actionSynthesis.planningWindowSeconds',
  );
  const minEnergyReserve = readOptionalNonNegativeFinite(
    record.minEnergyReserve,
    'actionSynthesis.minEnergyReserve',
  );
  const minSatietyReserve = readOptionalNonNegativeFinite(
    record.minSatietyReserve,
    'actionSynthesis.minSatietyReserve',
  );
  const minBalanceReserve = readOptionalNonNegativeFinite(
    record.minBalanceReserve,
    'actionSynthesis.minBalanceReserve',
  );
  const candidateSubtasks = parseActionSynthesisCandidateSubtasks(
    record.candidateSubtasks,
    'actionSynthesis.candidateSubtasks',
  );

  return {
    ...(maxActions === undefined ? {} : { maxActions }),
    ...(planningWindowSeconds === undefined ? {} : { planningWindowSeconds }),
    ...(minEnergyReserve === undefined ? {} : { minEnergyReserve }),
    ...(minSatietyReserve === undefined ? {} : { minSatietyReserve }),
    ...(minBalanceReserve === undefined ? {} : { minBalanceReserve }),
    ...(candidateSubtasks === undefined ? {} : { candidateSubtasks }),
  };
}

function parseActionSynthesisCandidateSubtasks(
  value: unknown,
  name: string,
): NonNullable<WorldStateActionSynthesisPolicyConfig['candidateSubtasks']> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = requireRecord(value, name);
  const maxSubtasks = readOptionalPositiveInteger(record.maxSubtasks, `${name}.maxSubtasks`);
  return {
    ...(maxSubtasks === undefined ? {} : { maxSubtasks }),
  };
}

function parsePaperAlignmentNode(input: {
  readonly node: unknown;
}): LocalRuntimeTownProfilePaperAlignmentConfig | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'paperAlignment');
  const minimumLocalRepairAcceptedCount = readOptionalNonNegativeInteger(
    record.minimumLocalRepairAcceptedCount,
    'paperAlignment.minimumLocalRepairAcceptedCount',
  );

  return {
    ...(minimumLocalRepairAcceptedCount === undefined ? {} : { minimumLocalRepairAcceptedCount }),
  };
}

function parseShortTermMemorySeedsNode(input: {
  readonly node: unknown;
}): readonly LocalRuntimeTownProfileShortTermMemorySeed[] | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }
  if (!Array.isArray(input.node)) {
    throw new Error('shortTermMemorySeeds must be an array');
  }
  return input.node.map((entry, index) =>
    parseShortTermMemorySeed(entry, `shortTermMemorySeeds[${index}]`),
  );
}

function parseShortTermMemorySeed(
  value: unknown,
  name: string,
): LocalRuntimeTownProfileShortTermMemorySeed {
  const record = requireRecord(value, name);
  return {
    record: createShortTermMemoryRecord({
      id: readRequiredString(record.id, `${name}.id`),
      agentId: asAgentId(readRequiredString(record.agentId, `${name}.agentId`)),
      kind: readShortTermMemoryKind(record.kind, `${name}.kind`),
      status: readShortTermMemoryStatus(record.status, `${name}.status`),
      summary: readRequiredString(record.summary, `${name}.summary`),
      occurredAt: readRequiredNonNegativeFinite(record.occurredAt, `${name}.occurredAt`),
      importanceScore: readRequiredRatio(record.importanceScore, `${name}.importanceScore`),
      source: parseShortTermMemorySource(record.source, `${name}.source`),
      tags: readOptionalStringArray(record.tags, `${name}.tags`) ?? [],
      ...(record.consolidationHint === undefined
        ? {}
        : {
            consolidationHint: parseMemoryConsolidationHint(
              record.consolidationHint,
              `${name}.consolidationHint`,
            ),
          }),
    }),
    replicateToProfileAgents:
      readOptionalBoolean(record.replicateToProfileAgents, `${name}.replicateToProfileAgents`) ??
      false,
  };
}

function parseShortTermMemorySource(value: unknown, name: string): MemorySource {
  if (value === undefined || value === null) {
    return { eventIds: [] };
  }
  const record = requireRecord(value, name);
  const commandId = readOptionalString(record.commandId, `${name}.commandId`);
  const eventIds = readOptionalStringArray(record.eventIds, `${name}.eventIds`) ?? [];
  return {
    ...(commandId === undefined ? {} : { commandId: asCommandId(commandId) }),
    eventIds: eventIds.map(asEventId),
  };
}

function parseMemoryConsolidationHint(value: unknown, name: string): MemoryConsolidationHint {
  const record = requireRecord(value, name);
  const kind = readRequiredString(record.kind, `${name}.kind`);
  if (kind === 'habit') {
    return {
      kind,
      patternKey: readRequiredString(record.patternKey, `${name}.patternKey`),
      statement: readRequiredString(record.statement, `${name}.statement`),
    };
  }
  if (kind === 'caution') {
    return {
      kind,
      patternKey: readRequiredString(record.patternKey, `${name}.patternKey`),
      statement: readRequiredString(record.statement, `${name}.statement`),
    };
  }
  if (kind === 'social') {
    return {
      kind,
      targetAgentId: asAgentId(readRequiredString(record.targetAgentId, `${name}.targetAgentId`)),
      relationDelta: readRequiredFinite(record.relationDelta, `${name}.relationDelta`),
      attitudeDelta: readRequiredFinite(record.attitudeDelta, `${name}.attitudeDelta`),
      summary: readRequiredString(record.summary, `${name}.summary`),
    };
  }
  throw new Error(`${name}.kind must be habit, caution, or social`);
}

function parseStudyDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['study'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.study');
  if (record === undefined) {
    return undefined;
  }
  const durationSeconds = readOptionalPositiveFinite(
    record.durationSeconds,
    'domainConfig.study.durationSeconds',
  );
  const educationRatePerSecond = readOptionalNonNegativeFinite(
    record.educationRatePerSecond,
    'domainConfig.study.educationRatePerSecond',
  );
  return {
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(educationRatePerSecond === undefined ? {} : { educationRatePerSecond }),
  };
}

function parseWorkDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['work'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.work');
  if (record === undefined) {
    return undefined;
  }
  const laborSeconds = readOptionalPositiveFinite(
    record.laborSeconds,
    'domainConfig.work.laborSeconds',
  );
  const defaultOccupationName = readOptionalString(
    record.defaultOccupationName,
    'domainConfig.work.defaultOccupationName',
  );
  return {
    ...(laborSeconds === undefined ? {} : { laborSeconds }),
    ...(defaultOccupationName === undefined ? {} : { defaultOccupationName }),
  };
}

function parseTradeDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['trade'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.trade');
  if (record === undefined) {
    return undefined;
  }
  const side = readOptionalTradeSide(record.side, 'domainConfig.trade.side');
  const commodityName = readOptionalString(
    record.commodityName,
    'domainConfig.trade.commodityName',
  );
  const quantity = readOptionalPositiveFinite(record.quantity, 'domainConfig.trade.quantity');
  return {
    ...(side === undefined ? {} : { side }),
    ...(commodityName === undefined ? {} : { commodityName }),
    ...(quantity === undefined ? {} : { quantity }),
  };
}

function parseSleepDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['sleep'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.sleep');
  if (record === undefined) {
    return undefined;
  }
  const durationSeconds = readOptionalPositiveFinite(
    record.durationSeconds,
    'domainConfig.sleep.durationSeconds',
  );
  return {
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function parseHealthDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['health'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.health');
  if (record === undefined) {
    return undefined;
  }
  const durationSeconds = readOptionalPositiveFinite(
    record.durationSeconds,
    'domainConfig.health.durationSeconds',
  );
  return {
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function parseEatDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['eat'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.eat');
  if (record === undefined) {
    return undefined;
  }
  const commodityName = readOptionalString(record.commodityName, 'domainConfig.eat.commodityName');
  const quantity = readOptionalPositiveFinite(record.quantity, 'domainConfig.eat.quantity');
  return {
    ...(commodityName === undefined ? {} : { commodityName }),
    ...(quantity === undefined ? {} : { quantity }),
  };
}

function parseSocialDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['social'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.social');
  if (record === undefined) {
    return undefined;
  }
  const targetAgentId = readOptionalString(
    record.targetAgentId,
    'domainConfig.social.targetAgentId',
  );
  const topic = readOptionalString(record.topic, 'domainConfig.social.topic');
  const openingUtterance = readOptionalString(
    record.openingUtterance,
    'domainConfig.social.openingUtterance',
  );
  const responseUtterance = readOptionalString(
    record.responseUtterance,
    'domainConfig.social.responseUtterance',
  );
  const relationDelta = readOptionalFinite(
    record.relationDelta,
    'domainConfig.social.relationDelta',
  );
  const attitudeDelta = readOptionalFinite(
    record.attitudeDelta,
    'domainConfig.social.attitudeDelta',
  );
  return {
    ...(targetAgentId === undefined ? {} : { targetAgentId: asAgentId(targetAgentId) }),
    ...(topic === undefined ? {} : { topic }),
    ...(openingUtterance === undefined ? {} : { openingUtterance }),
    ...(responseUtterance === undefined ? {} : { responseUtterance }),
    ...(relationDelta === undefined ? {} : { relationDelta }),
    ...(attitudeDelta === undefined ? {} : { attitudeDelta }),
  };
}

function parseProductionDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['production'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.production');
  if (record === undefined) {
    return undefined;
  }
  const commodityName = readOptionalString(
    record.commodityName,
    'domainConfig.production.commodityName',
  );
  const quantity = readOptionalPositiveFinite(record.quantity, 'domainConfig.production.quantity');
  const availableLaborSeconds = readOptionalPositiveFinite(
    record.availableLaborSeconds,
    'domainConfig.production.availableLaborSeconds',
  );
  return {
    ...(commodityName === undefined ? {} : { commodityName }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(availableLaborSeconds === undefined ? {} : { availableLaborSeconds }),
  };
}

function parseResidentialDomainConfig(value: unknown): CanonicalDomainRuntimeConfig['residential'] {
  const record = readOptionalNullableRecord(value, 'domainConfig.residential');
  if (record === undefined) {
    return undefined;
  }
  const targetResidentialTier = readOptionalPositiveInteger(
    record.targetResidentialTier,
    'domainConfig.residential.targetResidentialTier',
  );
  return {
    ...(targetResidentialTier === undefined ? {} : { targetResidentialTier }),
  };
}

function parseMemoryConsolidationScheduleNode(input: {
  readonly node: unknown;
}): LocalSimulationLifecycleMemoryConsolidationSchedule | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'memoryConsolidationSchedule');
  const agentIds = readOptionalStringArray(
    record.agentIds,
    'memoryConsolidationSchedule.agentIds',
  )?.map(asAgentId);
  const reflectionTrigger = parseMemoryConsolidationReflectionTrigger(
    record.reflectionTrigger,
    'memoryConsolidationSchedule.reflectionTrigger',
  );

  return {
    ...(agentIds === undefined ? {} : { agentIds }),
    retrievalLimit: readRequiredPositiveInteger(
      record.retrievalLimit,
      'memoryConsolidationSchedule.retrievalLimit',
    ),
    minPatternCount: readRequiredPositiveInteger(
      record.minPatternCount,
      'memoryConsolidationSchedule.minPatternCount',
    ),
    ...(reflectionTrigger === undefined ? {} : { reflectionTrigger }),
  };
}

function parseMemoryConsolidationReflectionTrigger(
  value: unknown,
  name: string,
): LocalSimulationLifecycleMemoryConsolidationSchedule['reflectionTrigger'] {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = requireRecord(value, name);
  return {
    minimumImportanceScore: readRequiredNonNegativeFinite(
      record.minimumImportanceScore,
      `${name}.minimumImportanceScore`,
    ),
  };
}

function parseSteeringSimulatorNode(input: {
  readonly node: unknown;
}): ReactiveActionSimulator | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'steeringSimulator');
  const kind = readRequiredString(record.kind, 'steeringSimulator.kind');
  if (kind !== 'reject-action-id-prefix-until-suffix') {
    throw new Error('steeringSimulator.kind must be reject-action-id-prefix-until-suffix');
  }
  const commandType = readOptionalCoreCommandType(
    record.commandType,
    'steeringSimulator.commandType',
  );
  const actionIdPrefix = readRequiredString(
    record.actionIdPrefix,
    'steeringSimulator.actionIdPrefix',
  );
  const repairedActionIdSuffix = readRequiredString(
    record.repairedActionIdSuffix,
    'steeringSimulator.repairedActionIdSuffix',
  );
  const reason = readRequiredString(record.reason, 'steeringSimulator.reason');

  return ({ action }) =>
    (commandType === undefined || action.commandType === commandType) &&
    action.id.startsWith(actionIdPrefix) &&
    !action.id.endsWith(repairedActionIdSuffix)
      ? { status: 'rejected', action, reason }
      : { status: 'accepted', action };
}

type LocalRuntimeTownProfileRuntimeConfigNodeName =
  | 'domainConfig'
  | 'actionSynthesis'
  | 'paperAlignment'
  | 'shortTermMemorySeeds'
  | 'llmPlanning'
  | 'dailyPlanning'
  | 'reactionPlanning'
  | 'subtaskPrioritization'
  | 'actionSequenceGeneration'
  | 'socialDialogue'
  | 'globalSynthesis'
  | 'reactiveCorrection'
  | 'replanningDecision'
  | 'reflectionSynthesis'
  | 'socialModelSynthesis'
  | 'replanningPolicy'
  | 'memoryConsolidationSchedule'
  | 'steeringSimulator';

function parseLlmStructuredProviderConfig(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): LlmStructuredProviderConfig {
  const record = requireRecord(value, `${nodeName}.provider`);
  const kind = readRequiredString(record.kind, `${nodeName}.provider.kind`);
  if (kind === 'openai-compatible') {
    return parseOpenAiCompatibleProviderConfig(record, env, nodeName);
  }
  if (kind === 'scripted') {
    return parseScriptedProviderConfig(record, nodeName);
  }

  throw new Error(`${nodeName}.provider.kind must be openai-compatible or scripted`);
}

function parseOpenAiCompatibleProviderConfig(
  record: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string | undefined>>,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): LlmStructuredProviderConfig {
  const apiKey = readOptionalSecretString(record.apiKey, `${nodeName}.provider.apiKey`, env);
  const defaultHeaders = parseOptionalDefaultHeaders(record.defaultHeaders, env, nodeName);
  const responseFormat = readOptionalResponseFormat(
    record.responseFormat,
    `${nodeName}.provider.responseFormat`,
  );

  return {
    kind: 'openai-compatible',
    providerId: readRequiredString(record.providerId, `${nodeName}.provider.providerId`),
    endpoint: readRequiredString(record.endpoint, `${nodeName}.provider.endpoint`),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
    ...(responseFormat === undefined ? {} : { responseFormat }),
  };
}

function parseScriptedProviderConfig(
  record: Readonly<Record<string, unknown>>,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): LlmStructuredProviderConfig {
  const responses = parseScriptedProviderResponses(
    record.responses,
    `${nodeName}.provider.scripted.responses`,
  );

  return {
    kind: 'scripted',
    providerId: readRequiredString(record.providerId, `${nodeName}.provider.providerId`),
    responses,
  };
}

function parseScriptedProviderResponses(
  value: unknown,
  name: string,
): readonly ScriptedLlmProviderResponse[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }

  return value.flatMap((entry, index) => parseScriptedProviderResponse(entry, `${name}[${index}]`));
}

function parseScriptedProviderResponse(
  value: unknown,
  name: string,
): readonly ScriptedLlmProviderResponse[] {
  const record = requireRecord(value, name);
  const usage = parseOptionalTokenUsage(record.usage, `${name}.usage`);
  const repeat = readOptionalPositiveInteger(record.repeat, `${name}.repeat`) ?? 1;
  const content = readOptionalString(record.content, `${name}.content`);
  const contentTemplate = readOptionalString(record.contentTemplate, `${name}.contentTemplate`);
  if (content !== undefined && contentTemplate !== undefined) {
    throw new Error(`${name} must define either content or contentTemplate, not both`);
  }
  if (content === undefined && contentTemplate === undefined) {
    throw new Error(`${name} must define content or contentTemplate`);
  }

  const responseBase = {
    providerId: readRequiredString(record.providerId, `${name}.providerId`),
    model: readRequiredString(record.model, `${name}.model`),
    finishReason: readProviderFinishReason(record.finishReason, `${name}.finishReason`),
    ...(usage === undefined ? {} : { usage }),
  };
  const response =
    contentTemplate === undefined
      ? {
          ...responseBase,
          content: content ?? '',
        }
      : (request: LlmProviderCompletionRequest): LlmProviderCompletionResponse => ({
          ...responseBase,
          content: renderScriptedContentTemplate({
            template: contentTemplate,
            request,
            name,
          }),
        });
  return Array.from({ length: repeat }, () => response);
}

function renderScriptedContentTemplate(input: {
  readonly template: string;
  readonly request: LlmProviderCompletionRequest;
  readonly name: string;
}): string {
  const context = createScriptedTemplateContext(input.request);
  return input.template.replace(
    /\{\{\s*(json\s+)?([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_match, jsonPrefix: string | undefined, path: string) => {
      const value = resolveTemplateValue(context, path, `${input.name}.contentTemplate`);
      return jsonPrefix === undefined
        ? stringifyTemplateValue(value)
        : stringifyJsonTemplateValue(value);
    },
  );
}

function createScriptedTemplateContext(
  request: LlmProviderCompletionRequest,
): Readonly<Record<string, unknown>> {
  const userMessage = [...request.messages].reverse().find((message) => message.role === 'user');
  const parsedUser = userMessage === undefined ? {} : parseOptionalJsonObject(userMessage.content);
  return {
    request: {
      requestId: request.requestId,
      model: request.model,
      schemaName: request.schemaName,
    },
    user: parsedUser,
  };
}

function parseOptionalJsonObject(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return requireRecord(parsed, 'scripted provider user message JSON');
  } catch (error) {
    throw new Error(
      `scripted provider user message must be JSON object: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveTemplateValue(
  context: Readonly<Record<string, unknown>>,
  path: string,
  name: string,
): unknown {
  const segments = path.split('.');
  let current: unknown = context;
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error(`${name} placeholder ${path} must not contain empty path segments`);
    }
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        throw new Error(
          `${name} placeholder ${path} array index ${segment} must be non-negative integer`,
        );
      }
      const index = Number(segment);
      if (index >= current.length) {
        throw new Error(`${name} placeholder ${path} array index ${index} is out of bounds`);
      }
      current = current[index];
      continue;
    }
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      throw new Error(`${name} placeholder ${path} does not resolve to a scalar value`);
    }
    const record = current as Readonly<Record<string, unknown>>;
    if (!(segment in record)) {
      throw new Error(`${name} placeholder ${path} is missing`);
    }
    current = record[segment];
  }
  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  throw new Error('scripted provider contentTemplate placeholders must resolve to scalar values');
}

function stringifyJsonTemplateValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error(
      'scripted provider contentTemplate json placeholders must be JSON-serializable',
    );
  }
  return serialized;
}

function parseOptionalTokenUsage(
  value: unknown,
  name: string,
): LlmProviderCompletionResponse['usage'] {
  const record = readOptionalRecord(value, name);
  if (record === undefined) {
    return undefined;
  }

  return {
    inputTokens: readRequiredNonNegativeFinite(record.inputTokens, `${name}.inputTokens`),
    outputTokens: readRequiredNonNegativeFinite(record.outputTokens, `${name}.outputTokens`),
  };
}

function readProviderFinishReason(value: unknown, name: string): LlmProviderFinishReason {
  if (value === 'stop' || value === 'length' || value === 'content-filtered') {
    return value;
  }
  throw new Error(`${name} must be stop, length, or content-filtered`);
}

function parseOptionalDefaultHeaders(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): Readonly<Record<string, string>> | undefined {
  const record = readOptionalRecord(value, `${nodeName}.provider.defaultHeaders`);
  if (record === undefined) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(record)) {
    assertNonEmpty(name, `${nodeName}.provider.defaultHeaders header name`);
    headers[name] = resolveSecretValue(
      headerValue,
      `${nodeName}.provider.defaultHeaders.${name}`,
      env,
    );
  }
  return headers;
}

function parseOptionalPricing(
  value: unknown,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): LlmGatewayPricing | undefined {
  const record = readOptionalRecord(value, `${nodeName}.pricing`);
  if (record === undefined) {
    return undefined;
  }

  return {
    inputTokenCostMicros: readRequiredNonNegativeFinite(
      record.inputTokenCostMicros,
      `${nodeName}.pricing.inputTokenCostMicros`,
    ),
    outputTokenCostMicros: readRequiredNonNegativeFinite(
      record.outputTokenCostMicros,
      `${nodeName}.pricing.outputTokenCostMicros`,
    ),
  };
}

function readOptionalSecretString(
  value: unknown,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return resolveSecretValue(value, name, env);
}

function resolveSecretValue(
  value: unknown,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (typeof value === 'string') {
    assertNonEmpty(value, name);
    return value;
  }

  const reference = requireRecord(value, name);
  const envName = readRequiredString(reference.env, `${name}.env`);
  const resolved = env[envName];
  if (resolved === undefined || resolved.trim().length === 0) {
    throw new Error(`environment variable ${envName} is required by ${name}`);
  }
  return resolved;
}

function readOptionalResponseFormat(
  value: unknown,
  name: string,
): OpenAiCompatibleResponseFormatMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'json-schema' || value === 'json-object' || value === 'none') {
    return value;
  }
  throw new Error(`${name} must be json-schema, json-object, or none`);
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  assertNonEmpty(value, name);
  return value;
}

function readOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredString(value, name);
}

function readOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function readOptionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readOptionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function readRequiredPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readRequiredNonNegativeFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
}

function readRequiredFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function readRequiredRatio(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number within [0, 1]`);
  }
  return value;
}

function readOptionalNonNegativeFinite(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredNonNegativeFinite(value, name);
}

function readOptionalPositiveFinite(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
}

function readOptionalFinite(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function readOptionalRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireRecord(value, name);
}

function readOptionalNullableRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireRecord(value, name);
}

function requireRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function readOptionalStringArray(value: unknown, name: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value.map((entry, index) => readRequiredString(entry, `${name}[${index}]`));
}

function readOptionalTradeSide(value: unknown, name: string): 'buy' | 'sell' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'buy' || value === 'sell') {
    return value;
  }
  throw new Error(`${name} must be buy or sell`);
}

function readOptionalCoreCommandType(value: unknown, name: string): CoreCommandType | undefined {
  if (value === undefined) {
    return undefined;
  }
  const commandType = readRequiredString(value, name);
  if ((CORE_COMMAND_TYPES as readonly string[]).includes(commandType)) {
    return commandType as CoreCommandType;
  }
  throw new Error(`${name} must be a known core command type`);
}

function readShortTermMemoryKind(value: unknown, name: string): ShortTermMemoryKind {
  const kind = readRequiredString(value, name);
  if ((SHORT_TERM_MEMORY_KINDS as readonly string[]).includes(kind)) {
    return kind as ShortTermMemoryKind;
  }
  throw new Error(`${name} must be a known short-term memory kind`);
}

function readShortTermMemoryStatus(value: unknown, name: string): ShortTermMemoryStatus {
  const status = readRequiredString(value, name);
  if ((SHORT_TERM_MEMORY_STATUSES as readonly string[]).includes(status)) {
    return status as ShortTermMemoryStatus;
  }
  throw new Error(`${name} must be a known short-term memory status`);
}

function parseOptionalMajorContextShift(
  value: unknown,
  name: string,
): AdaptiveReplanningPolicy['majorContextShift'] {
  if (value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, name);
  return {
    key: readRequiredString(record.key, `${name}.key`),
    reason: readRequiredString(record.reason, `${name}.reason`),
  };
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

import { createLlmStructuredProviderFromConfig } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { proposeActionSequenceWithLlm } from './llmActionSequenceGenerator';
import { createBranchPlan, type PrioritizedSubtask } from './planner';
import type { WorldDecisionContext } from './worldDecisionContext';

/**
 * Persona-framing drift measurement (AGENT_CONTEXT_DESIGN.md §6.5b).
 *
 * Runs the action-sequence stage against a real provider in two arms —
 * identical payloads except the persona arm's worldDecisionContext carries
 * displayName + lifecycle, which activates the citizen-framed system prompt —
 * and reports schema-parse failure rate plus action-type distribution drift.
 * Step 1 of the roadmap may only be marked "low risk" with this measurement;
 * without it the risk label is an assumption.
 *
 * Skipped unless PERSONA_DRIFT_MEASUREMENT=1; the provider comes from the
 * standard AIVILIZATION_LLM_* environment (see .env §1). Nondeterministic by
 * design — this is an experiment, not a regression test.
 */

const measurementEnabled = process.env.PERSONA_DRIFT_MEASUREMENT === '1';
const runsPerArm = Number.parseInt(process.env.PERSONA_DRIFT_RUNS ?? '12', 10);
const agentId = asAgentId('agent-1');

describe('persona framing drift measurement (real provider)', () => {
  test.skipIf(!measurementEnabled)(
    'measures parse-failure rate and action distribution across framing arms',
    async () => {
      const endpoint = requireEnv('AIVILIZATION_LLM_ENDPOINT');
      const model = requireEnv('AIVILIZATION_LLM_MODEL');
      const apiKey = process.env.AIVILIZATION_LLM_API_KEY;
      const provider = createLlmStructuredProviderFromConfig({
        kind: 'openai-compatible',
        providerId: 'persona-drift-measurement',
        endpoint,
        ...(apiKey === undefined || apiKey.length === 0 ? {} : { apiKey }),
        responseFormat: 'json-schema',
      });

      const neutral = await runArm(provider, model, 'neutral');
      const persona = await runArm(provider, model, 'persona');

      // Measurement report (console output is the deliverable of this experiment).
      console.log(
        [
          'persona drift measurement summary',
          `  model=${model} runsPerArm=${runsPerArm}`,
          `  neutral: accepted=${neutral.accepted} fallback=${neutral.fallback} distribution=${JSON.stringify(neutral.distribution)}`,
          `  persona: accepted=${persona.accepted} fallback=${persona.fallback} distribution=${JSON.stringify(persona.distribution)}`,
        ].join('\n'),
      );

      // Acceptance gate (§6.5c): persona framing must not regress parse success.
      expect(persona.accepted).toBeGreaterThan(0);
      expect(neutral.accepted + persona.accepted).toBeGreaterThan(0);
    },
    15 * 60 * 1000,
  );
});

async function runArm(
  provider: ReturnType<typeof createLlmStructuredProviderFromConfig>,
  model: string,
  arm: 'neutral' | 'persona',
): Promise<{ accepted: number; fallback: number; distribution: Record<string, number> }> {
  let accepted = 0;
  let fallback = 0;
  const distribution: Record<string, number> = {};
  for (let index = 0; index < runsPerArm; index += 1) {
    const startedAtMs = Date.now();
    const result = await proposeActionSequenceWithLlm({
      agentId,
      issuedAt: 200 + index,
      plan: createContextualPlan(),
      selectedSubtask,
      signals: [{ key: 'survival', weight: 4 }],
      deterministicActions,
      worldDecisionContext: arm === 'persona' ? createPersonaContext() : createNeutralContext(),
      provider,
      model,
      requestId: `persona-drift:${arm}:${index}`,
      pricing: { inputTokenCostMicros: 0, outputTokenCostMicros: 0 },
      // Single attempt + generous timeout: the provider-class latency on this
      // stage is 20-60s (reasoning model), so the production 30s×2 profile
      // mostly measures timeouts. One attempt attributes every failure
      // cleanly (schema-invalid vs provider-error) for the drift report.
      maxAttempts: 1,
      timeoutMs: 120_000,
    });
    const elapsedMs = Date.now() - startedAtMs;
    if (result.status === 'accepted') {
      accepted += 1;
      for (const action of result.actions) {
        distribution[action.commandType] = (distribution[action.commandType] ?? 0) + 1;
      }
    } else {
      fallback += 1;
    }
    // Progress line: makes hangs and latency visible in the run log.
    console.log(
      `[persona-drift] arm=${arm} run=${index + 1}/${runsPerArm} status=${result.status} failureReason=${result.trace.failureReason ?? 'none'} elapsedMs=${elapsedMs}`,
    );
  }
  return { accepted, fallback, distribution };
}

const selectedSubtask: PrioritizedSubtask = {
  branchId: 'recovery',
  subtaskId: 'eat',
  description: 'Restore energy and satiety before the afternoon work shift.',
  score: 8,
};

const deterministicActions: readonly AtomicActionProposal[] = [
  {
    id: 'fallback-eat',
    description: 'Eat Apple from inventory.',
    commandType: 'AgentEat',
    payload: { commodityName: 'Apple', quantity: 1 },
    priority: 8,
    resourceEstimate: { inventoryCosts: { Apple: 1 } },
  },
  {
    id: 'fallback-sleep',
    description: 'Sleep at home to recover energy.',
    commandType: 'AgentSleep',
    payload: { durationSeconds: 3600 },
    priority: 6,
    resourceEstimate: { actionSeconds: 3600 },
  },
  {
    id: 'fallback-work',
    description: 'Work a stock-clerk shift for wages.',
    commandType: 'AgentWork',
    payload: { laborSeconds: 1800 },
    priority: 4,
    resourceEstimate: { actionSeconds: 1800 },
  },
];

function createContextualPlan() {
  return createBranchPlan({
    objective: 'Balance physiological recovery with steady income.',
    branches: [
      {
        id: 'recovery',
        objective: 'Restore physiological stability.',
        subtasks: [
          {
            id: 'eat',
            description: 'Restore energy and satiety before the afternoon work shift.',
            basePriority: 8,
          },
        ],
      },
    ],
  });
}

function createNeutralContext(): WorldDecisionContext {
  return {
    agent: {
      agentId,
      locationId: 'market',
      physiology: { energy: 38, satiety: 31, health: 76 },
      educationScore: 31,
      balance: 420,
      residentialTier: 2,
      job: 'Stock Clerk',
      inventory: { Apple: 3, Fish: 2 },
    },
    market: {
      spotPrices: [
        { commodity: 'Apple', spotPrice: 12.5 },
        { commodity: 'Fish', spotPrice: 304.5 },
        { commodity: 'Bread', spotPrice: 18 },
      ],
    },
  };
}

function createPersonaContext(): WorldDecisionContext {
  const base = createNeutralContext();
  return {
    ...base,
    agent: {
      ...base.agent,
      displayName: 'Li Na',
      lifecycle: { stage: 'adult', ageDays: 9_125, retired: false },
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set for the persona drift measurement`);
  }
  return value;
}

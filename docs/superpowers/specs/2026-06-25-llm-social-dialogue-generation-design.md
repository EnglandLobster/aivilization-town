# LLM Social Dialogue Generation Design

## Problem

The current social domain runtime can emit `AgentStartConversation`, but its transcript is deterministic:

- the initiating turn is either configured test text or a fixed fallback opening
- the target reply is either configured test text or a fixed acknowledgement sentence

That keeps command execution replayable, but it does not implement the AIvilization paper's natural-language dialogue capability. It also creates a misleading surface: the world can persist conversations, yet the agent runtime never reasons about what either participant should say.

## Scope

This slice adds a dedicated social dialogue generation seam after action-sequence generation and before global synthesis / action synthesis.

It does not solve contextual prioritization, micro-planning, global synthesis, price feedback, or structured agent-state prompt coverage. Those remain separate gaps. This slice should, however, pass the same memory, profile, and world-decision context that the other LLM cycle stages already receive.

## Runtime Boundary

The boundary is `agent-runtime`, not `world`.

The worker social micro-planner still proposes a valid deterministic `AgentStartConversation` action. The new stage may replace only the conversation payload fields that belong to dialogue content:

- `topic`
- `turns`
- optional `relationDelta`
- optional `attitudeDelta`

The world command validator remains authoritative for command execution, participant existence, and event persistence.

## New Contracts

Add `packages/agent-runtime/src/socialDialogueGeneration.ts`.

Core types:

```ts
export type SocialDialogueTurnProposal = {
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export type SocialDialoguePayload = {
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly turns: readonly SocialDialogueTurnProposal[];
};

export type SocialDialogueProposal = {
  readonly topic: string;
  readonly turns: readonly SocialDialogueTurnProposal[];
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
  readonly rationale: string;
};

export type SocialDialogueGeneratorInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly action: AtomicActionProposal<'AgentStartConversation', SocialDialoguePayload>;
  readonly deterministicPayload: SocialDialoguePayload;
  readonly signals: readonly ContextSignal[];
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type SocialDialogueGenerator = (
  input: SocialDialogueGeneratorInput,
) => Promise<SocialDialogueGenerationResult>;
```

Trace shape follows the existing LLM cycle stages:

- `status`: `deterministic | accepted | fallback`
- `source`: `deterministic | llm | deterministic-fallback`
- selected subtask identity
- action id and target agent id
- request/provider/model/attempts/usage for LLM paths
- accepted turn count and rationale
- fallback failure reason/message

## Validation Rules

`applySocialDialogueProposal` must reject invalid LLM output before it can become a command draft.

Rules:

- topic must be non-empty
- turns must contain at least two entries
- every utterance must be non-empty
- every speaker must be either the acting agent or the target agent
- both participants must speak at least once
- the first turn must be from the acting agent
- `relationDelta` and `attitudeDelta`, when provided, must be finite numbers
- deterministic target, action id, command type, resource estimates, and synthesis context are preserved

On provider, schema, or validation failure, return the deterministic payload.

## LLM Compiler

Add `packages/agent-runtime/src/llmSocialDialogueGenerator.ts`.

Prompt input must include:

- agent id, target agent id, issuedAt
- selected subtask and branch plan
- deterministic fallback payload
- signals
- memory/profile/world decision context when available

The tool schema is `aivilization_social_dialogue_generation` with a single `dialogue` object containing `topic`, `turns`, optional deltas, and `rationale`.

Prompt constraints:

- only emit speakers from `agentId` and `targetAgentId`
- do not invent inventory, balance, market prices, relationships, or prior events outside supplied context
- preserve command executability; simulation and world validation remain authoritative
- keep turns compact enough for frequent simulation ticks

## Cycle Integration

Add optional `socialDialogueGenerator?: SocialDialogueGenerator` to `AgentPlanningCycleWithPrioritizationInput`.

Processing order:

1. prioritize subtasks
2. collect deterministic or generated action sequences
3. apply social dialogue generation to `AgentStartConversation` actions
4. run global synthesis if configured
5. run deterministic action synthesis and simulator repair/correction

This order lets a generic action-sequence LLM decide that a social action exists, while the social dialogue seam specializes the transcript content.

`AgentCycleResult` gains `socialDialogueGenerationTraces?: readonly SocialDialogueGenerationTrace[]`.

## Worker And Server Wiring

Add optional `socialDialogueGenerator` to:

- `WorkerAgentRuntimeBinding`
- `WorkerTickAgentInput`
- `runWorkerAgentCycle`
- canonical runtime resolver config
- local runtime profile LLM config

Runtime config kind:

```ts
{
  "kind": "traceable-llm-social-dialogue-generator",
  "profileId": "local-profile",
  "model": "...",
  "provider": { "...": "..." }
}
```

The worker trace should persist `socialDialogueGeneration` beside `actionSequenceGeneration`, `globalSynthesis`, and `actionRepair`.

## Acceptance Criteria

- Existing deterministic social tests keep passing with no LLM config.
- Agent-runtime tests prove valid LLM dialogue replaces only the conversation payload.
- Invalid speakers, single-speaker transcripts, empty utterances, or provider failure fall back deterministically.
- Cycle tests prove the generator runs before global synthesis and simulator dispatch.
- Worker/server tests prove runtime config can construct and inject the generator.
- `pnpm check` passes.

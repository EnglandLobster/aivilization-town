import { isSocialSignalName } from '@aivilization/society';
import type { AgentId } from '@aivilization/sim-core';
import type { SocialDialogueTurnProposal } from './socialDialogueGeneration';

export const SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION = 'llm-social-signal-extraction-v2';

/**
 * A raw extracted signal as proposed by an extractor: severity is optional and defaults to 1
 * (full rule-table strength) during validation.
 */
export type SocialSignalSeverityProposal = {
  readonly signal: string;
  readonly severity?: number;
};

export type SocialSignalTurnExtraction = {
  readonly turnIndex: number;
  readonly signals: readonly {
    readonly signal: string;
    readonly severity: number;
  }[];
};

export type SocialSignalExtractionInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly turns: readonly SocialDialogueTurnProposal[];
};

export type SocialSignalExtractionUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type SocialSignalExtractionTraceAttempt = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: SocialSignalExtractionUsage;
};

export type SocialSignalExtractionTrace = {
  /**
   * 'deterministic' means no extractor ran for the conversation and the world's keyword
   * adjudicator is the only signal source; 'no-proposal' means an extractor ran but produced
   * nothing usable and the same keyword fallback applies; 'accepted' means an LLM proposal was
   * validated and recorded into the command payload.
   */
  readonly status: 'deterministic' | 'accepted' | 'no-proposal';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly policyVersion: typeof SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION;
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly turnCount: number;
  readonly extractedSignalCount: number;
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly SocialSignalExtractionTraceAttempt[];
  readonly usage?: SocialSignalExtractionUsage;
};

/**
 * A signal extractor only proposes which canonical social signals each dialogue turn expresses and
 * how strongly (severity in [0, 1]). When it returns no proposal (`turnSignals` undefined), the
 * world's deterministic keyword adjudicator evaluates the transcript instead, so extraction
 * failures never change state.
 */
export type SocialSignalExtractionResult = {
  readonly turnSignals?: readonly SocialSignalTurnExtraction[];
  readonly trace: SocialSignalExtractionTrace;
};

export type SocialSignalExtractor = (
  input: SocialSignalExtractionInput,
) => Promise<SocialSignalExtractionResult>;

/**
 * Validates an extractor proposal against the canonical signal taxonomy and the transcript length.
 * Out-of-range turn indexes drop only that entry; a signal name outside the taxonomy or a severity
 * outside [0, 1] invalidates the whole proposal. A missing severity defaults to 1. Returns
 * undefined when nothing usable remains.
 */
export function validateSocialSignalTurnExtractions(input: {
  readonly turnCount: number;
  readonly entries: readonly {
    readonly turnIndex: number;
    readonly signals: readonly SocialSignalSeverityProposal[];
  }[];
}): readonly SocialSignalTurnExtraction[] | undefined {
  const cleaned: SocialSignalTurnExtraction[] = [];
  for (const entry of input.entries) {
    if (
      !Number.isInteger(entry.turnIndex) ||
      entry.turnIndex < 0 ||
      entry.turnIndex >= input.turnCount
    ) {
      continue;
    }
    if (entry.signals.length === 0 || entry.signals.some((signal) => !isSocialSignalName(signal.signal))) {
      return undefined;
    }
    if (
      entry.signals.some(
        (signal) =>
          signal.severity !== undefined &&
          (!Number.isFinite(signal.severity) || signal.severity < 0 || signal.severity > 1),
      )
    ) {
      return undefined;
    }
    const seenSignals = new Set<string>();
    const signals = entry.signals.flatMap((signal) => {
      if (seenSignals.has(signal.signal)) {
        return [];
      }
      seenSignals.add(signal.signal);
      return [{ signal: signal.signal, severity: signal.severity ?? 1 }];
    });
    cleaned.push({ turnIndex: entry.turnIndex, signals });
  }
  return cleaned.length === 0 ? undefined : cleaned;
}

export function createNoProposalSocialSignalExtractionResult(input: {
  readonly extractorInput: SocialSignalExtractionInput;
  readonly source: SocialSignalExtractionTrace['source'];
  readonly failureReason?: string;
  readonly message?: string;
}): SocialSignalExtractionResult {
  return {
    trace: {
      status: 'no-proposal',
      source: input.source,
      policyVersion: SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION,
      agentId: input.extractorInput.agentId,
      targetAgentId: input.extractorInput.targetAgentId,
      topic: input.extractorInput.topic,
      turnCount: input.extractorInput.turns.length,
      extractedSignalCount: 0,
      ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason }),
      ...(input.message === undefined ? {} : { message: input.message }),
    },
  };
}

/**
 * Trace recorded when no signal extractor is configured for a conversation: the world's
 * deterministic keyword adjudicator is the only signal source.
 */
export function createDeterministicSocialSignalExtractionTrace(
  input: SocialSignalExtractionInput,
): SocialSignalExtractionTrace {
  return {
    status: 'deterministic',
    source: 'deterministic',
    policyVersion: SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION,
    agentId: input.agentId,
    targetAgentId: input.targetAgentId,
    topic: input.topic,
    turnCount: input.turns.length,
    extractedSignalCount: 0,
  };
}

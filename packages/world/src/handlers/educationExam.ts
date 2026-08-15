import type { CommandEnvelope } from '@aivilization/sim-core';
import {
  calculateRecruitmentCycleNumber,
  deriveEducationLevel,
  evaluateEducationExamEligibility,
  evaluateWellbeingExamScoreBonus,
  type EducationSystemPolicy,
  type WellbeingPolicy,
} from '@aivilization/society';
import { assertAgentApplyEducationExamPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

/**
 * Parks one exam application (中考/高考/考研) for the current exam cycle. The
 * society domain decides eligibility; the world adapter owns the cycle number,
 * the per-cycle duplicate guard, and the durable Submitted event. Admission
 * itself is settled by AdvanceSimulationTime at the cycle boundary (放榜).
 */
export function handleAgentApplyEducationExamCommand(input: {
  readonly command: CommandEnvelope<'AgentApplyEducationExam', unknown>;
  readonly projection: WorldProjection;
  readonly policy: EducationSystemPolicy;
  /**
   * Optional town-wellbeing policy: when present (and the education policy
   * carries a wellbeingExamScoreBonus), the submission snapshots a
   * wellbeing-adjusted ranking score. Absent keeps submissions byte-for-byte
   * identical to pre-wellbeing runs.
   */
  readonly wellbeing?: WellbeingPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentApplyEducationExamPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyEducationExam', payloadResult.reason);
  }
  if (!input.policy.enabled) {
    return rejectCommand(input, 'AgentApplyEducationExam', 'education system policy is disabled');
  }

  const cycleNumber = calculateRecruitmentCycleNumber({
    simulationTime: input.projection.clock.now,
    cycleDurationMs: input.policy.examCycleDurationMs,
  });
  if (
    input.projection.educationExamApplications.some(
      (application) =>
        application.agentId === agent.agentId && application.cycleNumber === cycleNumber,
    )
  ) {
    return rejectCommand(
      input,
      'AgentApplyEducationExam',
      `duplicate education exam application in exam cycle ${cycleNumber}`,
    );
  }

  const eligibilityResult = parsePayload(() =>
    evaluateEducationExamEligibility({
      agent: {
        educationLevel:
          agent.educationLevel ?? deriveEducationLevel(agent.educationScore, input.policy),
        ...(agent.educationTrack === undefined ? {} : { educationTrack: agent.educationTrack }),
        educationScore: agent.educationScore,
        examAttempts: agent.examAttempts ?? 0,
      },
      targetLevel: payloadResult.payload.targetLevel,
      policy: input.policy,
    }),
  );
  if (eligibilityResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyEducationExam', eligibilityResult.reason);
  }
  if (eligibilityResult.payload.status === 'rejected') {
    return rejectCommand(
      input,
      'AgentApplyEducationExam',
      `${eligibilityResult.payload.reason}: ${eligibilityResult.payload.detail}`,
    );
  }

  const targetLevel = eligibilityResult.payload.targetLevel;
  const applicationId = `${input.command.id}:application`;
  const wellbeingBonus =
    input.wellbeing === undefined || input.policy.wellbeingExamScoreBonus === undefined
      ? undefined
      : evaluateWellbeingExamScoreBonus({
          wellbeing: agent.wellbeing ?? input.wellbeing.initialValue,
          policy: input.policy,
        });
  return [
    makeEvent(input, 0, 'EducationExamApplicationSubmitted', {
      applicationId,
      cycleNumber,
      agentId: agent.agentId,
      targetLevel,
      educationScore: agent.educationScore,
      ...(wellbeingBonus === undefined
        ? {}
        : { effectiveEducationScore: agent.educationScore + wellbeingBonus }),
    }),
    makeMemoryEvent(input, 1, {
      summary: `Submitted an application for the level-${targetLevel} education exam in exam cycle ${cycleNumber}.`,
      status: 'succeeded',
      tags: ['apply-education-exam', `exam-target:${targetLevel}`, `exam-cycle:${cycleNumber}`],
      consolidationHint: {
        kind: 'habit',
        patternKey: `apply-education-exam:${targetLevel}`,
        statement: `Applies for the level-${targetLevel} education exam when eligible.`,
      },
    }),
  ];
}

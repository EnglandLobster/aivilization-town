import {
  parseProgramResourceControl,
  resolveProgramActionsPolicy,
  type ProgramStep,
  type ProgramStepAuthority,
} from '@aivilization/collaboration';
import { tradeFactsEqual } from '@aivilization/commerce';
import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import { sharedRecordKey } from '@aivilization/information';
import { assertProgramResourceEffects } from './programResourceProof';
import { ORDERED_EFFECT_FAMILIES } from './effectOrder';
import { digest } from './jsonCommitments';
import type { OpenSocietyEffects, OpenSocietyState } from './types';

/** Match committed facts to the exact signed operation. Never call a live decision handler during replay. */
export function assertProgramStepEffects(
  state: OpenSocietyState,
  step: ProgramStep,
  authority: ProgramStepAuthority,
  effects: OpenSocietyEffects,
) {
  if (state.world.clock.now !== authority.at) throw Error('program-step-clock-mismatch');
  if (step.capability === 'resource.control') {
    const policy = resolveProgramActionsPolicy(
      state.coordination?.actionsPolicy,
      authority.policyVersion,
    );
    const action = policy && parseProgramResourceControl(step.arguments, policy);
    if (!action) throw Error('invalid-program-resource-action');
    return assertProgramResourceEffects(state, action, authority, effects);
  }
  const args = step.arguments,
    requestId = `program-${digest([authority.runId, authority.stepIndex]).slice(0, 32)}`;
  let expected: OpenSocietyEffects;
  if (step.capability === 'payments.transfer') {
    const event = effects.worldEvents?.[0];
    if (!event || event.type !== 'ResidentCommerceCommitted')
      throw Error('program-payment-effect-required');
    const transactionId = `commerce-${digest([authority.principalId, requestId]).slice(0, 32)}`;
    if (event.id !== `${transactionId}:commerce`) throw Error('program-payment-reference-mismatch');
    expected = {
      worldEvents: [
        {
          ...event,
          occurredAt: authority.at,
          payload: {
            policyVersion: 'resident-commerce-v1',
            events: [],
            stockTransfers: [],
            transactions: [
              createMoneyTransfer({
                transactionId,
                reason: 'payments.transfer',
                from: economicAccount('agent', authority.principalId),
                to: economicAccount('agent', String(args.targetId)),
                amount: Number(args.amount),
              }),
            ],
          },
        },
      ],
    };
  } else if (step.capability === 'messages.send') {
    expected = {
      informationEvents: [
        {
          type: 'MessageSent',
          message: {
            id: `msg-${digest([authority.principalId, requestId]).slice(0, 24)}`,
            senderId: authority.principalId,
            recipientId: String(args.recipientId),
            content: String(args.content),
            sentAt: authority.at,
            executedBy: authority.executedBy,
            mandateId: authority.mandateId,
            programRunId: authority.runId,
          },
        },
      ],
    };
  } else {
    const key =
      step.capability === 'records.append'
        ? `entry-${digest([authority.executedBy, requestId]).slice(0, 32)}`
        : String(args.key);
    const registerId = String(args.registerId),
      old = state.sharedRecords?.records[sharedRecordKey(registerId, key)],
      revision = step.capability === 'records.append' ? 0 : args.expectedRevision;
    if (revision !== (old?.revision ?? 0)) throw Error('program-record-revision-mismatch');
    const event = effects.sharedRecordsEvents?.[0];
    if (event?.type !== 'SharedRecordWritten' || !tradeFactsEqual(event.record.values, args.values))
      throw Error('program-record-values-mismatch');
    expected = {
      sharedRecordsEvents: [
        {
          type: 'SharedRecordWritten',
          record: {
            registerId,
            key,
            values: event.record.values,
            revision: (old?.revision ?? 0) + 1,
            createdBy: old?.createdBy ?? authority.executedBy,
            editedBy: authority.executedBy,
            authorityId: authority.principalId,
            deleted: false,
            at: authority.at,
          },
        },
      ],
    };
  }
  for (const family of ORDERED_EFFECT_FAMILIES)
    if (!tradeFactsEqual(effects[family] ?? [], expected[family] ?? []))
      throw Error('program-step-effects-mismatch');
}

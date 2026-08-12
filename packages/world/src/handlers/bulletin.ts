import type { CommandEnvelope, CoreCommandType } from '@aivilization/sim-core';
import { cloneTownBulletin, createTownBulletin, isBulletinEffective, type TownBulletinPolicy } from '../bulletin';
import { assertAgentPostBulletinPayload, assertIssueTownBulletinPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import type { handleAdvanceSimulationTimeCommand } from './timeAdvance';
import {
  copyHumanAttribution,
  makeEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentPostBulletinCommand(input: {
  readonly command: CommandEnvelope<'AgentPostBulletin', unknown>;
  readonly projection: WorldProjection;
  readonly bulletin?: TownBulletinPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.bulletin === undefined) {
    return rejectCommand(input, 'AgentPostBulletin', 'missing bulletin policy');
  }
  const payloadResult = parsePayload(() => assertAgentPostBulletinPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentPostBulletin', payloadResult.reason);
  }
  const bulletinResult = parsePayload(() =>
    createTownBulletin({
      bulletinId: `bulletin-${input.command.id}`,
      title: payloadResult.payload.title,
      body: payloadResult.payload.body,
      ...(payloadResult.payload.priority === undefined
        ? {}
        : { priority: payloadResult.payload.priority }),
      authorAgentId: agent.agentId,
      postedAt: input.command.issuedAt,
      ...(payloadResult.payload.effectiveAt === undefined
        ? {}
        : { effectiveAt: payloadResult.payload.effectiveAt }),
      currentSimulationTime: input.projection.clock.now,
    }),
  );
  if (bulletinResult.status === 'invalid') {
    return rejectCommand(input, 'AgentPostBulletin', bulletinResult.reason);
  }
  return settleBulletinPosting({ input, bulletin: bulletinResult.payload });
}

export function handleIssueTownBulletinCommand(input: {
  readonly command: CommandEnvelope<'IssueTownBulletin', unknown>;
  readonly projection: WorldProjection;
  readonly bulletin?: TownBulletinPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  if (input.bulletin === undefined) {
    throw new Error('IssueTownBulletin requires the town-bulletin policy');
  }
  const attribution = input.command.humanAttribution;
  if (input.command.source !== 'human' || attribution === undefined) {
    throw new Error('IssueTownBulletin requires human operator attribution');
  }
  if (!attribution.principalRoles.includes('operator')) {
    throw new Error('IssueTownBulletin requires the operator role');
  }
  const payload = assertIssueTownBulletinPayload(input.command.payload);
  const bulletin = createTownBulletin({
    bulletinId: `bulletin-${input.command.id}`,
    title: payload.title,
    body: payload.body,
    ...(payload.priority === undefined ? {} : { priority: payload.priority }),
    authorSubjectId: attribution.principalSubjectId,
    postedAt: input.command.issuedAt,
    ...(payload.effectiveAt === undefined ? {} : { effectiveAt: payload.effectiveAt }),
    currentSimulationTime: input.projection.clock.now,
  });
  return settleBulletinPosting({ input, bulletin });
}

export function settleBulletinPosting(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly bulletin: ReturnType<typeof createTownBulletin>;
}): WorldEvent[] {
  const bulletin = input.bulletin;
  if (
    (input.input.projection.bulletins ?? []).some(
      (entry) => entry.bulletinId === bulletin.bulletinId,
    )
  ) {
    throw new Error(`duplicate bulletin id ${bulletin.bulletinId}`);
  }
  const effective = isBulletinEffective(bulletin, input.input.projection.clock.now);
  return [
    makeEvent(input.input, 0, effective ? 'BulletinPosted' : 'BulletinScheduled', {
      bulletin,
      ...copyHumanAttribution(input.input.command),
    }),
  ];
}

/**
 * Activates scheduled bulletins whose effectiveAt the advancing clock has
 * reached. Data-driven (no policy gate): without the town-bulletin switch no
 * scheduled bulletins can exist, so this is a no-op on legacy runs.
 */

export function appendDueBulletinEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly nextSimulationTime: number;
}): void {
  const due = (input.input.projection.bulletins ?? [])
    .filter(
      (bulletin) =>
        bulletin.status === 'scheduled' && bulletin.effectiveAt <= input.nextSimulationTime,
    )
    .sort(
      (left, right) =>
        left.effectiveAt - right.effectiveAt || left.bulletinId.localeCompare(right.bulletinId),
    );
  for (const bulletin of due) {
    input.events.push(
      makeEvent(input.input, input.events.length, 'BulletinPosted', {
        bulletin: cloneTownBulletin(bulletin),
      }),
    );
  }
}

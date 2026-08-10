import type { LocalWorldRuntimeStepInput, LocalWorldRuntimeStepResult } from './localRuntimeStep';
import { runLocalWorldRuntimeStep } from './localRuntimeStep';

export type LocalWorldRuntimeLoopStep = {
  readonly tickIndex: number;
  readonly tickId: string;
  readonly issuedAt: number;
  readonly result: LocalWorldRuntimeStepResult;
  readonly tick?: Extract<LocalWorldRuntimeStepResult, { readonly status: 'ticked' }>['tick'];
};

export type LocalWorldRuntimeLoopPausePredicate = (input: {
  readonly tickIndex: number;
  readonly completedTickCount: number;
  readonly steps: readonly LocalWorldRuntimeLoopStep[];
}) => boolean;

export type LocalWorldRuntimeLoopInput = Omit<
  LocalWorldRuntimeStepInput,
  'tickId' | 'issuedAt' | 'commandCheckpointUpdatedAt' | 'recoveryToSequence'
> & {
  readonly loopId: string;
  readonly firstTickIndex?: number;
  readonly tickCount: number;
  readonly issuedAtStart: number;
  readonly tickIntervalMs: number;
  /**
   * Authoritative sequence before the interrupted lifecycle batch began.
   * Recovery advances this boundary after every replayed tick.
   */
  readonly firstTickRecoveryToSequence?: number;
  /**
   * Event-stream tail observed before recovery starts. Ticks remain in replay
   * mode until their reconstructed stream version reaches this boundary.
   */
  readonly recoveryThroughSequence?: number;
  readonly pauseBeforeTick?: LocalWorldRuntimeLoopPausePredicate;
};

export type LocalWorldRuntimeLoopResult =
  | {
      readonly status: 'completed';
      readonly steps: readonly LocalWorldRuntimeLoopStep[];
      readonly completedTickCount: number;
      readonly nextTickIndex: number;
      readonly projection: LocalWorldRuntimeStepResult['projection'];
    }
  | {
      readonly status: 'paused';
      readonly steps: readonly LocalWorldRuntimeLoopStep[];
      readonly completedTickCount: number;
      readonly nextTickIndex: number;
      readonly projection: LocalWorldRuntimeStepResult['projection'];
    }
  | {
      readonly status: 'command-drain-failed';
      readonly steps: readonly LocalWorldRuntimeLoopStep[];
      readonly completedTickCount: number;
      readonly nextTickIndex: number;
      readonly projection: LocalWorldRuntimeStepResult['projection'];
      readonly failedStep: LocalWorldRuntimeLoopStep;
    };

export async function runLocalWorldRuntimeLoop(
  input: LocalWorldRuntimeLoopInput,
): Promise<LocalWorldRuntimeLoopResult> {
  assertNonEmpty(input.loopId, 'loopId');
  assertPositiveInteger(input.tickCount, 'tickCount');
  assertPositiveInteger(input.firstTickIndex ?? 1, 'firstTickIndex');
  assertNonNegativeFinite(input.issuedAtStart, 'issuedAtStart');
  assertNonNegativeFinite(input.tickIntervalMs, 'tickIntervalMs');

  const steps: LocalWorldRuntimeLoopStep[] = [];
  const firstTickIndex = input.firstTickIndex ?? 1;
  let projection = input.initialProjection;
  let recoveryToSequence = input.firstTickRecoveryToSequence;

  if (
    recoveryToSequence !== undefined &&
    input.recoveryThroughSequence !== undefined &&
    input.recoveryThroughSequence < recoveryToSequence
  ) {
    throw new Error('recoveryThroughSequence must not precede firstTickRecoveryToSequence');
  }

  for (let offset = 0; offset < input.tickCount; offset += 1) {
    const tickIndex = firstTickIndex + offset;
    if (
      input.pauseBeforeTick?.({
        tickIndex,
        completedTickCount: steps.length,
        steps,
      }) === true
    ) {
      return {
        status: 'paused',
        steps,
        completedTickCount: steps.length,
        nextTickIndex: tickIndex,
        projection,
      };
    }

    const tickId = createLoopTickId(input.loopId, tickIndex);
    const issuedAt = input.issuedAtStart + (tickIndex - 1) * input.tickIntervalMs;
    const recoveringInterruptedPrefix =
      recoveryToSequence !== undefined &&
      (input.recoveryThroughSequence === undefined
        ? offset === 0
        : recoveryToSequence < input.recoveryThroughSequence);
    const result = await runLocalWorldRuntimeStep({
      ...input,
      tickId,
      issuedAt,
      commandCheckpointUpdatedAt: issuedAt,
      ...(recoveringInterruptedPrefix ? { recoveryToSequence } : {}),
    });
    projection = result.projection;
    if (recoveringInterruptedPrefix && result.status === 'ticked') {
      recoveryToSequence = result.tick.streamVersion;
    }
    const step = createLoopStep({ tickIndex, tickId, issuedAt, result });
    steps.push(step);

    if (result.status === 'command-drain-failed') {
      return {
        status: 'command-drain-failed',
        steps,
        completedTickCount: steps.length - 1,
        nextTickIndex: tickIndex,
        projection,
        failedStep: step,
      };
    }
  }

  return {
    status: 'completed',
    steps,
    completedTickCount: steps.length,
    nextTickIndex: firstTickIndex + input.tickCount,
    projection,
  };
}

function createLoopStep(input: {
  readonly tickIndex: number;
  readonly tickId: string;
  readonly issuedAt: number;
  readonly result: LocalWorldRuntimeStepResult;
}): LocalWorldRuntimeLoopStep {
  return {
    tickIndex: input.tickIndex,
    tickId: input.tickId,
    issuedAt: input.issuedAt,
    result: input.result,
    ...(input.result.status === 'ticked' ? { tick: input.result.tick } : {}),
  };
}

function createLoopTickId(loopId: string, tickIndex: number): string {
  return `${loopId}:tick:${tickIndex}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

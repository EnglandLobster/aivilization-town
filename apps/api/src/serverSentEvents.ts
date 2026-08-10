import type { TownHttpApiRequest } from './httpApi';

export type TownServerSentEvent = {
  readonly id?: string;
  readonly event?: string;
  readonly retry?: number;
  readonly data: unknown;
};

export type TownServerSentEventRouteContext = {
  readonly signal: AbortSignal;
};

export type TownServerSentEventRoute = {
  readonly match: (request: TownHttpApiRequest) => boolean;
  readonly createStream: (
    request: TownHttpApiRequest,
    context: TownServerSentEventRouteContext,
  ) => AsyncIterable<TownServerSentEvent>;
};

export function formatServerSentEvent(event: TownServerSentEvent): string {
  const lines: string[] = [];
  if (event.id !== undefined) {
    lines.push(`id: ${event.id}`);
  }
  if (event.event !== undefined) {
    lines.push(`event: ${event.event}`);
  }
  if (event.retry !== undefined) {
    lines.push(`retry: ${event.retry}`);
  }
  lines.push(`data: ${JSON.stringify(event.data)}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

export function delayUntilAbortable(input: {
  readonly ms: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  if (input.signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, input.ms);
    input.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

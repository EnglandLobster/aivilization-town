import { describe, expect, test } from 'vitest';
import { formatServerSentEvent } from './serverSentEvents';

describe('server-sent event formatting', () => {
  test('formats id, event name, JSON data, retry, and blank-line terminator', () => {
    const formatted = formatServerSentEvent({
      id: '42',
      event: 'sync',
      retry: 1000,
      data: {
        streamVersion: 42,
        events: [{ sequence: 42, type: 'SimulationTimeAdvanced' }],
      },
    });

    expect(formatted).toBe(
      [
        'id: 42',
        'event: sync',
        'retry: 1000',
        'data: {"streamVersion":42,"events":[{"sequence":42,"type":"SimulationTimeAdvanced"}]}',
        '',
        '',
      ].join('\n'),
    );
  });
});

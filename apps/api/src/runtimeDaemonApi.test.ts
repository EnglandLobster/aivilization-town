import { describe, expect, test } from 'vitest';
import { createRuntimeDaemonApiService } from './index';

type TestDaemonStatus = {
  readonly manifestId: string;
  readonly health: 'healthy' | 'attention';
};

describe('runtime daemon API service', () => {
  test('delegates daemon status lookup to the control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeDaemonApiService<TestDaemonStatus>({
      control: {
        getStatus: () => {
          calls.push({ method: 'getStatus' });
          return Promise.resolve({ manifestId: 'town-runtime', health: 'healthy' });
        },
      },
    });

    await expect(service.getRuntimeDaemonStatus()).resolves.toEqual({
      manifestId: 'town-runtime',
      health: 'healthy',
    });
    expect(calls).toEqual([{ method: 'getStatus' }]);
  });
});

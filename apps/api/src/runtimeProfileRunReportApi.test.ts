import { describe, expect, test } from 'vitest';
import { createRuntimeProfileRunReportApiService } from './index';

type TestRuntimeProfileRunReport = {
  readonly runId: string;
  readonly profileId: string;
  readonly generatedAt: number;
};

describe('runtime profile run report API service', () => {
  test('normalizes report requests before delegating to the injected query port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeProfileRunReportApiService<TestRuntimeProfileRunReport>({
      reports: {
        getReport: (request) => {
          calls.push({ method: 'getReport', request });
          return Promise.resolve({
            runId: request.runId,
            profileId: 'smoke-25',
            generatedAt: 200,
          });
        },
        queryReports: (request) => {
          calls.push({ method: 'queryReports', request });
          return Promise.resolve([
            {
              runId: request.runId ?? 'run-200',
              profileId: request.profileId ?? 'smoke-25',
              generatedAt: 200,
            },
          ]);
        },
      },
    });

    await expect(
      service.queryRuntimeProfileRunReports({
        runId: 'run-200',
        profileId: 'smoke-25',
        fromGeneratedAt: 100,
        toGeneratedAt: 200,
        limit: 2,
      }),
    ).resolves.toEqual([{ runId: 'run-200', profileId: 'smoke-25', generatedAt: 200 }]);
    await expect(service.getRuntimeProfileRunReport({ runId: 'run-200' })).resolves.toEqual({
      runId: 'run-200',
      profileId: 'smoke-25',
      generatedAt: 200,
    });

    expect(calls).toEqual([
      {
        method: 'queryReports',
        request: {
          runId: 'run-200',
          profileId: 'smoke-25',
          fromGeneratedAt: 100,
          toGeneratedAt: 200,
          limit: 2,
        },
      },
      { method: 'getReport', request: { runId: 'run-200' } },
    ]);
  });

  test('rejects invalid profile report requests before hitting the query port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeProfileRunReportApiService<TestRuntimeProfileRunReport>({
      reports: {
        getReport: (request) => {
          calls.push(request);
          return Promise.resolve(undefined);
        },
        queryReports: (request) => {
          calls.push(request);
          return Promise.resolve([]);
        },
      },
    });

    await expect(service.getRuntimeProfileRunReport({ runId: ' ' })).rejects.toThrow(
      'runId must not be empty',
    );
    await expect(service.queryRuntimeProfileRunReports({ runId: ' ' })).rejects.toThrow(
      'runId must not be empty',
    );
    await expect(service.queryRuntimeProfileRunReports({ profileId: ' ' })).rejects.toThrow(
      'profileId must not be empty',
    );
    await expect(
      service.queryRuntimeProfileRunReports({ fromGeneratedAt: Number.NaN }),
    ).rejects.toThrow('fromGeneratedAt must be finite');
    await expect(
      service.queryRuntimeProfileRunReports({ toGeneratedAt: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow('toGeneratedAt must be finite');
    await expect(service.queryRuntimeProfileRunReports({ limit: 0 })).rejects.toThrow(
      'limit must be a positive integer',
    );

    expect(calls).toEqual([]);
  });
});

import { emptyTown, readTown, record, rows, text, numeric } from './model';
import type { Row, Selection, Town, View } from './model';

export type Snapshot = {
  town: Town;
  projection: Row;
  society: Row;
  directory: Row;
  runtime: Row;
  daemon: Row;
  access: Row;
  partitions: Row[];
  partition: Row;
  resources: Record<string, unknown>;
  selection: Selection;
  view: View;
  loading: boolean;
  connected: boolean;
  errors: string[];
  observedAt: number;
  theme: 'light' | 'dark';
  refreshInterval: number;
};
const initial = (): Snapshot => ({
  town: emptyTown(),
  projection: {},
  society: {},
  directory: {},
  runtime: {},
  daemon: {},
  access: {},
  partitions: [],
  partition: {},
  resources: {},
  selection: null,
  view: viewFromHash(),
  loading: true,
  connected: false,
  errors: [],
  observedAt: 0,
  theme: 'light',
  refreshInterval: 5000,
});
export function viewFromHash(): View {
  const value = window.location.hash.slice(1);
  return ['town', 'market', 'cognition', 'overview', 'steering'].includes(value)
    ? (value as View)
    : 'map';
}
export function createTownClient() {
  let state = initial();
  const listeners = new Set<() => void>();
  let abort = new AbortController();
  let revision = 0;
  let running = false;
  let queued = false;
  let stream: EventSource | null = null;
  let streamKey = '';
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let acceptedConsent = '';
  let token = '';
  try {
    token = window.sessionStorage.getItem('aivilization.access-token') ?? '';
  } catch {
    /* In-memory access still works. */
  }
  const publish = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const base = () =>
    `/simulations/${encodeURIComponent(text(state.partition.simulationId, ''))}/partitions/${encodeURIComponent(text(state.partition.partitionKey, ''))}`;
  async function request(
    path: string,
    body?: Row,
    authenticated = false,
    signal = abort.signal,
  ): Promise<unknown> {
    const response = await fetch(path, {
      signal,
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(authenticated && token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const result: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        text(
          record(record(result).error).message,
          text(record(result).message, `Request failed (${response.status})`),
        ),
      );
    return result;
  }
  function connect() {
    const key = base();
    if (streamKey === key || stopped) return;
    stream?.close();
    streamKey = key;
    stream = new EventSource(`${key}/sync-stream?afterSequence=${state.town.sequence}&limit=200`);
    stream.addEventListener('open', () => publish({ connected: true }));
    stream.addEventListener('error', () => publish({ connected: false }));
    stream.addEventListener('sync-batch', () => {
      if (streamTimer) return;
      streamTimer = setTimeout(() => {
        streamTimer = undefined;
        void refresh();
      }, 250);
    });
  }
  async function refresh() {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    const currentRevision = revision;
    const errors: string[] = [];
    const signal = abort.signal;
    const optional = async (path: string): Promise<unknown> => {
      try {
        return await request(path, undefined, path === '/access/session', signal);
      } catch (error) {
        if (!signal.aborted)
          errors.push(`${path}: ${error instanceof Error ? error.message : 'Unavailable'}`);
        return undefined;
      }
    };
    publish({ loading: true });
    try {
      const [runtimeValue, daemonValue, accessValue] = await Promise.all([
        request('/runtime/status', undefined, false, signal),
        optional('/runtime/daemon/status'),
        optional('/access/session'),
      ]);
      if (currentRevision !== revision || stopped) return;
      const runtime = record(runtimeValue);
      const partitions = rows(runtime.partitions);
      const partition =
        partitions.find(
          (item) =>
            item.simulationId === state.partition.simulationId &&
            item.partitionKey === state.partition.partitionKey,
        ) ??
        partitions[0] ??
        {};
      if (!partition.partitionKey) throw new Error('No simulation partitions are available.');
      const sameSimulation = partition.simulationId === state.partition.simulationId;
      publish({
        ...(sameSimulation ? {} : { society: {}, directory: {}, selection: null, resources: {} }),
        runtime,
        daemon: record(daemonValue),
        access: record(accessValue),
        partitions,
        partition,
      });
      const cityBase = `/simulations/${encodeURIComponent(text(partition.simulationId))}/society`;
      const [envelope, society, directory] = await Promise.all([
        request(`${base()}/projection`, undefined, false, signal),
        optional(`${cityBase}/projection`),
        optional(`${cityBase}/agents`),
      ]);
      if (currentRevision !== revision || stopped) return;
      const town = readTown(
        record(envelope),
        record(society ?? state.society),
        record(directory ?? state.directory),
        text(partition.partitionKey),
      );
      publish({
        town,
        projection: record(record(envelope).projection),
        society: record(society ?? state.society),
        directory: record(directory ?? state.directory),
        observedAt: Date.now(),
        errors,
      });
      connect();
      await loadResources(currentRevision, signal);
    } catch (error) {
      if (!signal.aborted && currentRevision === revision)
        publish({
          errors: [error instanceof Error ? error.message : 'Unable to load the town'],
          connected: false,
        });
    } finally {
      running = false;
      if (!stopped) publish({ loading: false });
      if (queued && !stopped) {
        queued = false;
        void refresh();
      }
    }
  }
  async function loadResources(currentRevision = revision, signal = abort.signal) {
    const view = state.view;
    const agentId = state.selection?.type === 'agent' ? state.selection.id : '';
    const paths: Record<string, string> =
      view === 'market'
        ? {
            trades: '/market-observations/trades?limit=50',
            bars: '/market-observations/ohlc-bars?limit=50',
          }
        : view === 'overview'
          ? { reports: '/validation-reports?limit=20' }
          : view === 'steering'
            ? { steering: '/steering-traces?limit=50' }
            : view === 'cognition' && agentId
              ? {
                  plans: `/branch-plans?agentId=${encodeURIComponent(agentId)}&limit=20`,
                  profile: `/agent-profiles/${encodeURIComponent(agentId)}`,
                  cycles: `/agent-cycle-traces?agentId=${encodeURIComponent(agentId)}&limit=20`,
                  objectives: `/objective-renewal-traces?agentId=${encodeURIComponent(agentId)}&limit=20`,
                  daily: `/daily-plan-renewal-traces?agentId=${encodeURIComponent(agentId)}&limit=20`,
                }
              : {};
    const result = await Promise.all(
      Object.entries(paths).map(async ([key, path]) => {
        try {
          return [key, await request(`${base()}${path}`, undefined, false, signal)] as const;
        } catch (error) {
          return [key, { error: error instanceof Error ? error.message : 'Unavailable' }] as const;
        }
      }),
    );
    if (
      currentRevision === revision &&
      state.view === view &&
      !signal.aborted &&
      !stopped &&
      (view !== 'cognition' ||
        (state.selection?.type === 'agent' && state.selection.id === agentId))
    )
      publish({ resources: Object.fromEntries(result) });
  }
  function invalidate() {
    revision += 1;
    abort.abort();
    abort = new AbortController();
    publish({ resources: {} });
  }
  function setView(view: View) {
    publish({ view, resources: {} });
    window.history.replaceState(null, '', `#${view}`);
    if (state.partition.partitionKey) void loadResources();
  }
  function select(selection: Selection) {
    publish({ selection, resources: {} });
    if (selection?.type === 'agent') {
      const owner = state.town.agents[selection.id]?.ownerPartitionKey;
      if (owner && owner !== state.partition.partitionKey) {
        invalidate();
        publish({ partition: { ...state.partition, partitionKey: owner } });
        void refresh();
      } else if (state.view === 'cognition') void loadResources();
    }
  }
  function setPartition(key: string) {
    const partition = state.partitions.find(
      (item) => `${text(item.simulationId)}/${text(item.partitionKey)}` === key,
    );
    if (!partition) return;
    invalidate();
    stream?.close();
    streamKey = '';
    publish({
      partition,
      town: emptyTown(),
      projection: {},
      society: {},
      directory: {},
      selection: null,
    });
    void refresh();
  }
  function setRefreshInterval(interval: number) {
    if (refreshTimer) clearInterval(refreshTimer);
    publish({ refreshInterval: interval });
    if (interval > 0)
      refreshTimer = setInterval(() => {
        if (!document.hidden) void refresh();
      }, interval);
  }
  async function mutate(path: string, body: Row, participant = false) {
    const policy = record(state.access.policy);
    if (
      participant &&
      policy.mode === 'authenticated' &&
      acceptedConsent !== policy.consentPolicyVersion
    )
      throw new Error(
        'Accept the current participant data consent policy in Access before submitting.',
      );
    const result = await request(
      path.startsWith('/runtime/') ? path : `${base()}${path}`,
      {
        ...body,
        ...(participant && policy.consentPolicyVersion
          ? { consentPolicyVersion: policy.consentPolicyVersion }
          : {}),
      },
      true,
      new AbortController().signal,
    );
    await refresh();
    return record(result);
  }
  async function authenticate(nextToken: string, consent: boolean) {
    invalidate();
    token = nextToken;
    try {
      if (token) window.sessionStorage.setItem('aivilization.access-token', token);
      else window.sessionStorage.removeItem('aivilization.access-token');
    } catch {
      /* In-memory access still works. */
    }
    const access = record(await request('/access/session', undefined, true));
    acceptedConsent = consent ? text(record(access.policy).consentPolicyVersion, '') : '';
    publish({ access });
    void refresh();
    if (token && record(access.authentication).authenticated !== true)
      throw new Error('The access token was not accepted.');
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    setView,
    select,
    setPartition,
    setRefreshInterval,
    mutate,
    authenticate,
    setTheme: (theme: 'light' | 'dark') => publish({ theme }),
    start() {
      stopped = false;
      setRefreshInterval(5000);
      void refresh();
    },
    destroy() {
      stopped = true;
      abort.abort();
      stream?.close();
      if (refreshTimer) clearInterval(refreshTimer);
      if (streamTimer) clearTimeout(streamTimer);
      listeners.clear();
    },
    simulationNow: () => numeric(state.town.clock),
  };
}
export type TownClient = ReturnType<typeof createTownClient>;

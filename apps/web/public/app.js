/**
 * Entry module for the living-town observatory. Responsibilities: shared
 * state, API/SSE data flow, hash routing between the canvas and the workspace
 * overlays, form submissions, and assembly of the map renderer, inspector
 * drawer and workspace panels. Rendering logic lives in `ui/panels/*`, map
 * machinery in `ui/map/*`.
 *
 * Honesty contract: agents have no continuous coordinates; map movement is
 * deterministic client-side interpolation (see ui/map/interpolation.js) and
 * is labeled "semantic layout · interpolated movement" in the UI.
 */
import { createMapRenderer } from './map/renderer.js';
import {
  asArray,
  createWorkspaces,
  escapeHtml,
  formatNumber,
  splitWords,
} from './panels/workspaces.js';
import {
  computeAgentMarkers,
  createInspector,
  updateBulletinBadge,
} from './panels/inspector.js';

const state = {
  accessToken: readSessionAccessToken(),
  accessRevision: 0,
  accessSession: undefined,
  accessError: '',
  acceptedConsentPolicyVersion: '',
  runtimeStatus: undefined,
  daemonStatus: undefined,
  partition: undefined,
  projectionEnvelope: undefined,
  societyDirectory: undefined,
  societyProjection: undefined,
  validationReports: [],
  trades: [],
  ohlcBars: [],
  plans: [],
  profile: undefined,
  cycleTraces: [],
  objectiveTraces: [],
  dailyTraces: [],
  steeringTraces: [],
  selectedAgentId: '',
  selectedLocationId: 'school',
  activeView: 'map',
  agentSearch: '',
  clockSyncedAtMs: 0,
  refreshInFlight: false,
  refreshQueued: false,
  partialErrors: [],
  eventSource: undefined,
  refreshTimer: undefined,
  streamRefreshTimer: undefined,
};

const viewTitles = {
  map: 'Living town',
  overview: 'Mission control',
  town: 'Population',
  market: 'Economy',
  cognition: 'Agent cognition',
  steering: 'Human interventions',
};

const viewDescriptions = {
  map: 'The canvas is the primary view: agents move between buildings as the simulation advances.',
  overview: 'Follow runtime health, scientific evidence, and the whole simulation from one place.',
  town: 'Inspect every Agent as a situated participant in the simulation-wide town and labor system.',
  market:
    'Read liquidity, prices, trades, and whether market settlement is unified or still partitioned.',
  cognition: 'Trace plans, memory, and decision evidence for a selected Agent.',
  steering: 'Submit authorized commands and verify their durable effect on the simulation.',
};

const elements = {
  connectionStatus: byId('connection-status'),
  lastUpdated: byId('last-updated'),
  themeToggle: byId('theme-toggle'),
  bulletinBadge: byId('bulletin-badge'),
  viewTitle: byId('view-title'),
  viewDescription: byId('view-description'),
  partitionSelect: byId('partition-select'),
  refreshInterval: byId('refresh-interval'),
  refreshButton: byId('refresh-button'),
  globalAlert: byId('global-alert'),
  accessStatus: byId('access-status'),
  accessDetail: byId('access-detail'),
  accessTokenForm: byId('access-token-form'),
  clearAccessToken: byId('clear-access-token'),
  accessResult: byId('access-result'),
  creatorAttributionField: byId('creator-attribution-field'),
  overviewMetrics: byId('overview-metrics'),
  sloSummary: byId('slo-summary'),
  sloTable: byId('slo-table'),
  partitionTable: byId('partition-table'),
  validationList: byId('validation-list'),
  runtimeForm: byId('runtime-form'),
  runtimeActionResult: byId('runtime-action-result'),
  townCanvas: byId('town-canvas'),
  townAgentTotal: byId('town-agent-total'),
  inspector: byId('inspector'),
  inspectorClose: byId('inspector-close'),
  townLocationInspector: byId('town-location-inspector'),
  agentInspector: byId('agent-inspector'),
  inspectorBulletins: byId('inspector-bulletins'),
  agentSearch: byId('agent-search'),
  agentTable: byId('agent-table'),
  agentDetailTitle: byId('agent-detail-title'),
  agentDetail: byId('agent-detail'),
  locationsGrid: byId('locations-grid'),
  marketMetrics: byId('market-metrics'),
  poolTable: byId('pool-table'),
  priceIndexList: byId('price-index-list'),
  tradeTable: byId('trade-table'),
  ohlcTable: byId('ohlc-table'),
  cognitionAgentLabel: byId('cognition-agent-label'),
  cognitionAgentSelect: byId('cognition-agent-select'),
  planCount: byId('plan-count'),
  planTree: byId('plan-tree'),
  profileDetail: byId('profile-detail'),
  cycleTraces: byId('cycle-traces'),
  objectiveTraces: byId('objective-traces'),
  dailyTraces: byId('daily-traces'),
  agentRegistrationForm: byId('agent-registration-form'),
  agentRegistrationResult: byId('agent-registration-result'),
  objectiveForm: byId('objective-form'),
  reactiveForm: byId('reactive-form'),
  objectiveResult: byId('objective-result'),
  reactiveResult: byId('reactive-result'),
  steeringTraces: byId('steering-traces'),
  refreshSteering: byId('refresh-steering'),
  replayForm: byId('replay-form'),
  replayResult: byId('replay-result'),
  toastRegion: byId('toast-region'),
};

const workspaces = createWorkspaces({
  state,
  elements,
  byId,
  projection,
  townProjection,
});

const inspector = createInspector({ state, elements, projection, townProjection });

const mapRenderer = createMapRenderer({
  canvas: elements.townCanvas,
  getNow: estimatedSimulationNow,
  onSelect: handleMapSelect,
});

initializeTheme();
bindNavigation();
activateView(readViewFromLocation(), { updateLocation: false });
bindControls();
resetCommandIdentifiers();
configureRefreshTimer();
void refreshAll({ discover: true });

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`required element not found: ${id}`);
  }
  return element;
}

// ---------------------------------------------------------------------------
// Navigation: canvas-first shell with workspace overlays and hash routing
// ---------------------------------------------------------------------------

function bindNavigation() {
  document.querySelectorAll('[data-view]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      // Clicking the active tab closes its overlay and returns to the map.
      activateView(state.activeView === view ? 'map' : view);
    });
    tab.addEventListener('keydown', (event) => {
      const previousKeys = ['ArrowLeft', 'ArrowUp'];
      const nextKeys = ['ArrowRight', 'ArrowDown'];
      const navigationKeys = [...previousKeys, ...nextKeys, 'Home', 'End'];
      if (!navigationKeys.includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-view]')];
      const current = tabs.indexOf(tab);
      const delta = nextKeys.includes(event.key) ? 1 : -1;
      const next =
        event.key === 'Home'
          ? tabs.at(0)
          : event.key === 'End'
            ? tabs.at(-1)
            : tabs[(current + delta + tabs.length) % tabs.length];
      next?.focus();
      if (next) activateView(next.dataset.view);
    });
  });
  document.querySelectorAll('[data-close-overlay]').forEach((button) => {
    button.addEventListener('click', () => activateView('map'));
  });
  window.addEventListener('hashchange', () => {
    activateView(readViewFromLocation(), { updateLocation: false });
  });
}

function activateView(view, options = {}) {
  if (!viewTitles[view]) return;
  state.activeView = view;
  // A full-width workspace overlay would collide with the inspector drawer;
  // hide the drawer while an overlay is active (map selection is preserved).
  if (view !== 'map') inspector.close();
  document.querySelectorAll('[data-view]').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    const active = panel.dataset.panel === view;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  elements.viewTitle.textContent = viewTitles[view];
  elements.viewDescription.textContent = viewDescriptions[view];
  document.title = `${viewTitles[view]} · Aivilization`;
  if (options.updateLocation !== false && window.location.hash !== `#${view}`) {
    window.history.pushState(null, '', `#${view}`);
  }
}

function readViewFromLocation() {
  const requestedView = window.location.hash.slice(1);
  return viewTitles[requestedView] ? requestedView : 'map';
}

// ---------------------------------------------------------------------------
// Map wiring
// ---------------------------------------------------------------------------

function handleMapSelect(picked) {
  if (!picked) {
    clearMapSelection();
    return;
  }
  if (picked.type === 'location') {
    state.selectedLocationId = picked.id;
    inspector.showLocation(picked.id);
    mapRenderer.setSelection({ type: 'location', id: picked.id });
    workspaces.renderTown();
    return;
  }
  selectAgent(picked.id, { switchView: false });
  inspector.showAgent(picked.id);
  mapRenderer.setSelection({ type: 'agent', id: picked.id });
}

function clearMapSelection() {
  inspector.close();
  mapRenderer.setSelection(null);
}

/** Estimated current simulation time: last authoritative clock + wall elapsed. */
function estimatedSimulationNow() {
  const clock = projection()?.clock;
  if (clock && Number.isFinite(clock.now) && state.clockSyncedAtMs) {
    return clock.now + (Date.now() - state.clockSyncedAtMs);
  }
  return Date.now();
}

/** Pushes the latest world snapshot into the canvas renderer (flag-aware). */
function pushMapWorld() {
  const world = townProjection() || {};
  mapRenderer.setWorld({
    locations: world.locations || {},
    agents: world.agents || {},
    transitByAgent: world.transitByAgent || {},
    weather: state.societyProjection?.weather ?? projection()?.weather,
    markersByAgent: computeAgentMarkers(state),
  });
  const agentCount = Object.keys(world.agents || {}).length;
  elements.townAgentTotal.textContent = `${formatNumber(agentCount, 0)} Agents${
    state.societyProjection ? ' · simulation-wide' : ''
  }`;
  updateBulletinBadge(elements, state);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function bindControls() {
  elements.themeToggle.addEventListener('click', cycleTheme);
  elements.refreshButton.addEventListener('click', () => void refreshAll({ discover: true }));
  elements.refreshInterval.addEventListener('change', configureRefreshTimer);
  elements.partitionSelect.addEventListener('change', () => {
    const option = elements.partitionSelect.selectedOptions[0];
    if (!option) return;
    state.partition = {
      simulationId: option.dataset.simulationId,
      partitionKey: option.dataset.partitionKey,
    };
    state.selectedAgentId = '';
    state.profile = undefined;
    closeEventStream();
    void refreshAll({ discover: false });
  });
  byId('map-zoom-in').addEventListener('click', () => mapRenderer.zoomBy(1.25));
  byId('map-zoom-out').addEventListener('click', () => mapRenderer.zoomBy(1 / 1.25));
  byId('map-reset').addEventListener('click', () => mapRenderer.resetCamera());
  elements.inspectorClose.addEventListener('click', clearMapSelection);
  elements.bulletinBadge.addEventListener('click', () => inspector.showBulletins());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clearMapSelection();
  });
  elements.inspector.addEventListener('click', handleInspectorSelection);
  elements.agentSearch.addEventListener('input', () => {
    state.agentSearch = elements.agentSearch.value.trim().toLowerCase();
    workspaces.renderTown();
  });
  elements.agentTable.addEventListener('click', handleAgentTableSelection);
  elements.agentTable.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      handleAgentTableSelection(event);
    }
  });
  elements.locationsGrid.addEventListener('click', (event) => {
    const location = event.target.closest('[data-location-id]');
    if (!location) return;
    handleMapSelect({ type: 'location', id: location.dataset.locationId });
  });
  elements.cognitionAgentSelect.addEventListener('change', () => {
    selectAgent(elements.cognitionAgentSelect.value, { switchView: false });
  });
  elements.runtimeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitRuntimeAction('run');
  });
  elements.runtimeForm.querySelectorAll('[data-runtime-action]').forEach((button) => {
    if (button.dataset.runtimeAction === 'run') return;
    button.addEventListener('click', () => void submitRuntimeAction(button.dataset.runtimeAction));
  });
  elements.objectiveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitObjective();
  });
  elements.accessTokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void useAccessToken();
  });
  elements.clearAccessToken.addEventListener('click', () => {
    clearAccessToken();
    void refreshAll({ discover: false });
  });
  elements.agentRegistrationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitAgentRegistration();
  });
  elements.reactiveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitReactiveCommand();
  });
  elements.replayForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitReplay();
  });
  elements.refreshSteering.addEventListener('click', () => void refreshSteeringTraces());
}

function handleAgentTableSelection(event) {
  const row = event.target.closest('[data-agent-id]');
  if (!row) return;
  selectAgent(row.dataset.agentId, { switchView: false });
  if (inspector.currentMode() === 'agent') inspector.showAgent(row.dataset.agentId);
}

function handleInspectorSelection(event) {
  const cognitionLink = event.target.closest('[data-open-cognition]');
  if (cognitionLink) {
    selectAgent(cognitionLink.dataset.openCognition, { switchView: true });
    return;
  }
  const agent = event.target.closest('[data-agent-id]');
  if (agent) {
    selectAgent(agent.dataset.agentId, { switchView: false });
    inspector.showAgent(agent.dataset.agentId);
    mapRenderer.setSelection({ type: 'agent', id: agent.dataset.agentId });
    return;
  }
  if (!event.target.closest('[data-location-filter]')) return;
  state.agentSearch = state.selectedLocationId.toLowerCase();
  elements.agentSearch.value = state.selectedLocationId;
  workspaces.renderTown();
  activateView('town');
}

function selectAgent(agentId, options) {
  if (!agentId) return;
  const societyAgent = asArray(state.societyDirectory?.agents).find(
    (candidate) => candidate.agentId === agentId,
  );
  if (
    societyAgent &&
    (societyAgent.ownerPartitionKey !== state.partition?.partitionKey ||
      state.societyDirectory.simulationId !== state.partition?.simulationId)
  ) {
    state.partition = {
      simulationId: state.societyDirectory.simulationId,
      partitionKey: societyAgent.ownerPartitionKey,
    };
    state.selectedAgentId = agentId;
    state.profile = undefined;
    closeEventStream();
    void refreshAll({ discover: false });
    return;
  }
  const nextLocationId = projection()?.agents?.[agentId]?.locationId;
  const agentChanged = agentId !== state.selectedAgentId;
  const locationChanged = nextLocationId && nextLocationId !== state.selectedLocationId;
  if (!agentChanged && !locationChanged) return;
  state.selectedAgentId = agentId;
  if (nextLocationId) state.selectedLocationId = nextLocationId;
  workspaces.syncAgentSelectors();
  workspaces.renderTown();
  workspaces.renderCognition();
  void loadAgentCognition();
  if (options.switchView) activateView('cognition');
}

// ---------------------------------------------------------------------------
// Data loading (unchanged API contracts)
// ---------------------------------------------------------------------------

async function refreshAll(options = {}) {
  if (state.refreshInFlight) {
    state.refreshQueued = true;
    return;
  }
  state.refreshInFlight = true;
  state.partialErrors = [];
  setLoading(true);

  try {
    const accessRevision = state.accessRevision;
    const [accessSession, runtimeStatus, daemonStatus] = await Promise.all([
      loadAccessSession(accessRevision),
      api('/runtime/status'),
      api('/runtime/daemon/status'),
    ]);
    if (accessRevision === state.accessRevision) state.accessSession = accessSession;
    state.runtimeStatus = runtimeStatus;
    state.daemonStatus = daemonStatus;
    if (options.discover || !state.partition) {
      discoverPartition(runtimeStatus);
    }
    workspaces.renderPartitionOptions();
    if (!state.partition) {
      throw new Error('runtime status contains no simulation partitions');
    }
    await loadPartitionData();
    connectEventStream();
    workspaces.renderAll();
    inspector.render();
    pushMapWorld();
    setConnectionStatus(daemonStatus.health || 'healthy');
    elements.lastUpdated.textContent = `Observed ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    showGlobalError(readErrorMessage(error));
    setConnectionStatus('attention');
  } finally {
    state.refreshInFlight = false;
    setLoading(false);
    if (state.refreshQueued) {
      state.refreshQueued = false;
      void refreshAll({ discover: false });
    }
  }
}

function discoverPartition(runtimeStatus) {
  const partitions = asArray(runtimeStatus?.partitions);
  const existing = partitions.find(
    (partition) =>
      partition.simulationId === state.partition?.simulationId &&
      partition.partitionKey === state.partition?.partitionKey,
  );
  const selected = existing || partitions[0];
  state.partition = selected
    ? { simulationId: selected.simulationId, partitionKey: selected.partitionKey }
    : undefined;
}

async function loadPartitionData() {
  const base = partitionBase();
  const societyBase = `/simulations/${encodeURIComponent(state.partition.simulationId)}/society`;
  const tasks = {
    projectionEnvelope: loadOptional(`${base}/projection`, undefined),
    societyDirectory: loadOptional(`${societyBase}/agents`, undefined),
    societyProjection: loadOptional(`${societyBase}/projection`, undefined),
    validationReports: loadOptional(`${base}/validation-reports?limit=20`, []),
    trades: loadOptional(`${base}/market-observations/trades?limit=50`, []),
    ohlcBars: loadOptional(`${base}/market-observations/ohlc-bars?limit=50`, []),
    steeringTraces: loadOptional(`${base}/steering-traces?limit=50`, []),
  };
  const results = await Promise.all(Object.values(tasks));
  Object.keys(tasks).forEach((key, index) => {
    state[key] = results[index];
  });
  state.clockSyncedAtMs = Date.now();

  const agentIds = Object.keys(projection()?.agents || {}).sort();
  if (!state.selectedAgentId || !agentIds.includes(state.selectedAgentId)) {
    state.selectedAgentId = agentIds[0] || '';
  }
  await loadAgentCognition();
}

async function loadAgentCognition() {
  if (!state.partition || !state.selectedAgentId) {
    state.plans = [];
    state.profile = undefined;
    state.cycleTraces = [];
    state.objectiveTraces = [];
    state.dailyTraces = [];
    workspaces.renderCognition();
    return;
  }
  const base = partitionBase();
  const agent = encodeURIComponent(state.selectedAgentId);
  const [plans, profile, cycleTraces, objectiveTraces, dailyTraces] = await Promise.all([
    loadOptional(`${base}/branch-plans?agentId=${agent}&limit=20`, []),
    loadOptional(`${base}/agent-profiles/${agent}`, undefined),
    loadOptional(`${base}/agent-cycle-traces?agentId=${agent}&limit=20`, []),
    loadOptional(`${base}/objective-renewal-traces?agentId=${agent}&limit=20`, []),
    loadOptional(`${base}/daily-plan-renewal-traces?agentId=${agent}&limit=20`, []),
  ]);
  state.plans = plans;
  state.profile = profile;
  state.cycleTraces = cycleTraces;
  state.objectiveTraces = objectiveTraces;
  state.dailyTraces = dailyTraces;
  workspaces.renderCognition();
}

async function loadOptional(path, fallback) {
  try {
    return await api(path);
  } catch (error) {
    state.partialErrors.push(`${path}: ${readErrorMessage(error)}`);
    return fallback;
  }
}

async function loadAccessSession(accessRevision = state.accessRevision) {
  if (accessRevision === state.accessRevision) state.accessError = '';
  try {
    return await api('/access/session', { authenticated: Boolean(state.accessToken) });
  } catch (error) {
    if (accessRevision === state.accessRevision) state.accessError = readErrorMessage(error);
    return undefined;
  }
}

async function api(path, options = {}) {
  const { authenticated = false, ...requestOptions } = options;
  const headers = { accept: 'application/json', ...(requestOptions.headers || {}) };
  if (authenticated && state.accessToken) {
    headers.authorization = `Bearer ${state.accessToken}`;
  }
  const response = await fetch(path, { ...requestOptions, headers });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message = body?.error?.message || body?.message || String(body) || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return body;
}

function partitionBase() {
  if (!state.partition) throw new Error('no active partition');
  return `/simulations/${encodeURIComponent(state.partition.simulationId)}/partitions/${encodeURIComponent(state.partition.partitionKey)}`;
}

function projection() {
  return state.projectionEnvelope?.projection;
}

function townProjection() {
  const society = state.societyProjection;
  const directory = state.societyDirectory;
  if (!society || !directory) return projection();
  const locations = Object.fromEntries(
    asArray(society.locations).map((entry) => [entry.location?.locationId, entry.location]),
  );
  const agents = Object.fromEntries(
    asArray(directory.agents).map((agent) => [
      agent.agentId,
      {
        agentId: agent.agentId,
        locationId: agent.publicState?.locationId || null,
        job: agent.publicState?.job || null,
        residentialTier: agent.publicState?.residentialTier || 0,
        educationScore: agent.publicState?.educationScore || 0,
        registration: agent.publicState?.displayName
          ? { displayName: agent.publicState.displayName }
          : undefined,
      },
    ]),
  );
  const transitByAgent = Object.fromEntries(
    asArray(directory.agents)
      .filter((agent) => agent.publicState?.transit)
      .map((agent) => [agent.agentId, { agentId: agent.agentId, ...agent.publicState.transit }]),
  );
  return { locations, agents, transitByAgent };
}

// ---------------------------------------------------------------------------
// Mutations (unchanged API contracts)
// ---------------------------------------------------------------------------

async function submitRuntimeAction(action) {
  const resultElement = elements.runtimeActionResult;
  setActionPending(resultElement, `${action} request in progress…`);
  try {
    const formData = new FormData(elements.runtimeForm);
    const body = { requestedAt: Date.now() };
    if (action === 'run') body.cycleCount = Number(formData.get('cycleCount'));
    const result = await postJson(`/runtime/${action}`, body);
    showActionResult(
      resultElement,
      `${splitWords(action)} accepted · ${result.traceId || result.outcome || 'completed'}`,
      true,
    );
    toast(`Runtime ${action} completed`);
    await refreshAll({ discover: true });
  } catch (error) {
    showActionResult(resultElement, readErrorMessage(error), false);
    toast(`Runtime ${action} failed`, true);
  }
}

async function submitObjective() {
  const formData = new FormData(elements.objectiveForm);
  setActionPending(elements.objectiveResult, 'Submitting durable objective…');
  try {
    const body = {
      agentId: String(formData.get('agentId')),
      objectiveId: String(formData.get('objectiveId')),
      statement: String(formData.get('statement')),
      priority: Number(formData.get('priority')),
      affinityTags: parseTags(formData.get('affinityTags')),
      issuedAt: simulationNow(),
    };
    const result = await postJson(`${partitionBase()}/objectives`, body);
    showActionResult(
      elements.objectiveResult,
      `Accepted into command store · ${result.commandId || body.objectiveId}`,
      true,
    );
    toast(`Objective queued for ${body.agentId}`);
    resetCommandIdentifiers();
    await refreshSteeringTraces();
  } catch (error) {
    showActionResult(elements.objectiveResult, readErrorMessage(error), false);
    toast('Objective submission failed', true);
  }
}

async function submitAgentRegistration() {
  const formData = new FormData(elements.agentRegistrationForm);
  setActionPending(elements.agentRegistrationResult, 'Submitting durable registration…');
  try {
    const body = {
      agentId: String(formData.get('agentId')),
      displayName: String(formData.get('displayName')),
      issuedAt: simulationNow(),
    };
    if (state.accessSession?.policy?.mode !== 'authenticated') {
      body.creatorId = String(formData.get('creatorId'));
    }
    const result = await postJson(`${partitionBase()}/agents`, body);
    showActionResult(
      elements.agentRegistrationResult,
      `Accepted into command store · ${result.command?.id || body.agentId}. Run or await the next cycle to materialize it.`,
      true,
    );
    toast(`Agent registration queued for ${body.agentId}`);
    resetCommandIdentifiers();
  } catch (error) {
    showActionResult(elements.agentRegistrationResult, readErrorMessage(error), false);
    toast('Agent registration failed', true);
  }
}

async function submitReactiveCommand() {
  const formData = new FormData(elements.reactiveForm);
  setActionPending(elements.reactiveResult, 'Routing reactive command…');
  try {
    const body = {
      agentId: String(formData.get('agentId')),
      reactiveCommandId: String(formData.get('reactiveCommandId')),
      summary: String(formData.get('summary')),
      tags: parseTags(formData.get('tags')),
      issuedAt: simulationNow(),
    };
    const result = await postJson(`${partitionBase()}/reactive-commands`, body);
    showActionResult(
      elements.reactiveResult,
      `Accepted into command store · ${result.commandId || body.reactiveCommandId}`,
      true,
    );
    toast(`Reactive command queued for ${body.agentId}`);
    resetCommandIdentifiers();
    await refreshSteeringTraces();
  } catch (error) {
    showActionResult(elements.reactiveResult, readErrorMessage(error), false);
    toast('Reactive command submission failed', true);
  }
}

async function submitReplay() {
  const formData = new FormData(elements.replayForm);
  const fromSequence = Number(formData.get('fromSequence'));
  const rawTo = String(formData.get('toSequence') || '').trim();
  const body = {
    requestedAt: simulationNow(),
    fromSequence,
    ...(rawTo ? { toSequence: Number(rawTo) } : {}),
  };
  setActionPending(elements.replayResult, 'Replaying durable event range…');
  try {
    const result = await postJson(`${partitionBase()}/replay`, body);
    showActionResult(
      elements.replayResult,
      `Replay ${result.status || 'completed'} · sequence ${formatNumber(result.state?.lastAppliedSequence ?? rawTo ?? fromSequence, 0)}`,
      true,
    );
    toast('Simulation replay completed');
    await refreshAll({ discover: false });
  } catch (error) {
    showActionResult(elements.replayResult, readErrorMessage(error), false);
    toast('Simulation replay failed', true);
  }
}

async function postJson(path, body) {
  const isParticipantMutation = /\/partitions\/[^/]+\/(agents|objectives|reactive-commands)$/u.test(
    path,
  );
  const consentPolicyVersion = state.accessSession?.policy?.consentPolicyVersion;
  if (
    isParticipantMutation &&
    state.accessSession?.policy?.mode === 'authenticated' &&
    state.acceptedConsentPolicyVersion !== consentPolicyVersion
  ) {
    throw new Error('Accept the current participant data consent policy before submitting.');
  }
  const governedBody =
    isParticipantMutation && consentPolicyVersion ? { ...body, consentPolicyVersion } : body;
  return api(path, {
    method: 'POST',
    authenticated: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(governedBody),
  });
}

async function useAccessToken() {
  const formData = new FormData(elements.accessTokenForm);
  const token = String(formData.get('token') || '').trim();
  if (!token) {
    showActionResult(elements.accessResult, 'Enter a provisioned Bearer token.', false);
    return;
  }
  if (formData.get('consent') !== 'on') {
    showActionResult(elements.accessResult, 'Participant data consent is required.', false);
    return;
  }
  const accessRevision = state.accessRevision + 1;
  state.accessRevision = accessRevision;
  state.accessToken = token;
  writeSessionAccessToken(token);
  elements.accessTokenForm.reset();
  showActionResult(elements.accessResult, 'Validating access token…', true);
  const accessSession = await loadAccessSession(accessRevision);
  if (accessRevision !== state.accessRevision) return;
  state.accessSession = accessSession;
  state.acceptedConsentPolicyVersion = accessSession?.policy?.consentPolicyVersion || '';
  workspaces.renderAccess();
  workspaces.syncAgentSelectors();
  if (accessSession?.authentication?.authenticated) {
    showActionResult(
      elements.accessResult,
      `Authenticated as ${accessSession.authentication.principal.subjectId}.`,
      true,
    );
  } else {
    showActionResult(elements.accessResult, state.accessError || 'Token was not accepted.', false);
  }
  void refreshAll({ discover: false });
}

function clearAccessToken() {
  state.accessRevision += 1;
  state.accessToken = '';
  state.acceptedConsentPolicyVersion = '';
  state.accessSession = undefined;
  state.accessError = '';
  try {
    window.sessionStorage.removeItem('aivilization.access-token');
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  showActionResult(elements.accessResult, 'Access token cleared for this tab.', true);
}

function readSessionAccessToken() {
  try {
    return window.sessionStorage.getItem('aivilization.access-token') || '';
  } catch {
    return '';
  }
}

function writeSessionAccessToken(token) {
  try {
    window.sessionStorage.setItem('aivilization.access-token', token);
  } catch {
    // The in-memory token still applies to the current page lifecycle.
  }
}

async function refreshSteeringTraces() {
  state.steeringTraces = await loadOptional(`${partitionBase()}/steering-traces?limit=50`, []);
  workspaces.renderSteering();
}

// ---------------------------------------------------------------------------
// SSE invalidation (unchanged protocol: sync-batch → debounced refreshAll)
// ---------------------------------------------------------------------------

function connectEventStream() {
  if (!state.partition || typeof EventSource === 'undefined') return;
  const streamKey = `${state.partition.simulationId}/${state.partition.partitionKey}`;
  if (state.eventSource?.datasetKey === streamKey) return;
  closeEventStream();
  const afterSequence = state.projectionEnvelope?.lastAppliedSequence || 0;
  const source = new EventSource(
    `${partitionBase()}/sync-stream?afterSequence=${afterSequence}&limit=200`,
  );
  source.datasetKey = streamKey;
  source.addEventListener('sync-batch', scheduleStreamRefresh);
  source.addEventListener('error', () => setConnectionStatus('degraded'));
  source.addEventListener('open', () =>
    setConnectionStatus(state.daemonStatus?.health || 'healthy'),
  );
  state.eventSource = source;
}

function scheduleStreamRefresh() {
  if (state.streamRefreshTimer) return;
  state.streamRefreshTimer = setTimeout(() => {
    state.streamRefreshTimer = undefined;
    void refreshAll({ discover: false });
  }, 250);
}

function closeEventStream() {
  state.eventSource?.close();
  state.eventSource = undefined;
}

function configureRefreshTimer() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = undefined;
  const interval = Number(elements.refreshInterval.value);
  if (interval > 0) {
    state.refreshTimer = setInterval(() => void refreshAll({ discover: true }), interval);
  }
}

// ---------------------------------------------------------------------------
// Theme, feedback, small utilities
// ---------------------------------------------------------------------------

function initializeTheme() {
  const stored = window.localStorage.getItem('aivilization-theme');
  document.documentElement.dataset.theme = ['light', 'dark', 'system'].includes(stored)
    ? stored
    : 'system';
  updateThemeLabel();
}

function cycleTheme() {
  const themes = ['system', 'light', 'dark'];
  const current = document.documentElement.dataset.theme || 'system';
  const next = themes[(themes.indexOf(current) + 1) % themes.length];
  document.documentElement.dataset.theme = next;
  window.localStorage.setItem('aivilization-theme', next);
  updateThemeLabel();
}

function updateThemeLabel() {
  const theme = document.documentElement.dataset.theme || 'system';
  elements.themeToggle.setAttribute('aria-label', `Color theme: ${theme}. Activate to switch.`);
  elements.themeToggle.title = `Color theme: ${theme}`;
}

function setLoading(loading) {
  elements.refreshButton.disabled = loading;
  elements.refreshButton.textContent = loading ? 'Refreshing…' : 'Refresh now';
}

function setConnectionStatus(status) {
  elements.connectionStatus.className = `status-badge ${statusClassFor(status)}`;
  elements.connectionStatus.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${escapeHtml(splitWords(status))}`;
}

function statusClassFor(status) {
  const normalized = String(status || 'neutral').toLowerCase();
  if (normalized === 'healthy') return 'status-healthy';
  if (normalized === 'degraded') return 'status-degraded';
  if (normalized === 'attention') return 'status-attention';
  return 'status-neutral';
}

function showGlobalError(message) {
  elements.globalAlert.hidden = false;
  elements.globalAlert.className = 'alert error';
  elements.globalAlert.textContent = `Unable to refresh live runtime data: ${message}`;
}

function showActionResult(element, message, success) {
  element.className = `action-result ${success ? 'success' : 'error'}`;
  element.textContent = message;
}

function setActionPending(element, message) {
  element.className = 'action-result';
  element.textContent = message;
}

function toast(message, isError = false) {
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  setTimeout(() => item.remove(), 4500);
}

function resetCommandIdentifiers() {
  const stamp = Date.now().toString(36);
  elements.agentRegistrationForm.elements.agentId.value = `human-agent-${stamp}`;
  elements.agentRegistrationForm.elements.displayName.value = `Agent ${stamp.slice(-5)}`;
  elements.objectiveForm.elements.objectiveId.value = `human-objective-${stamp}`;
  elements.reactiveForm.elements.reactiveCommandId.value = `human-reactive-${stamp}`;
}

function simulationNow() {
  const now = projection()?.clock?.now;
  return Number.isFinite(now) && now >= 0 ? now : Date.now();
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

(() => {
  'use strict';

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
    townLayer: 'population',
    agentSearch: '',
    refreshInFlight: false,
    refreshQueued: false,
    partialErrors: [],
    eventSource: undefined,
    refreshTimer: undefined,
    streamRefreshTimer: undefined,
  };

  const viewTitles = {
    overview: 'Mission control',
    town: 'Population',
    market: 'Economy',
    cognition: 'Agent cognition',
    steering: 'Human interventions',
  };

  const viewDescriptions = {
    overview:
      'Follow runtime health, scientific evidence, and the active partition from one place.',
    town: 'Inspect every Agent as a situated participant in the shared town and labor system.',
    market: 'Read liquidity, prices, trades, and aggregate observations as one economic record.',
    cognition: 'Trace plans, memory, and decision evidence for a selected Agent.',
    steering: 'Submit authorized commands and verify their durable effect on the simulation.',
  };

  const townMapLayout = {
    'town-square': { className: 'town-square' },
    'residential-block': { className: 'residential-block' },
    school: { className: 'school' },
    clinic: { className: 'clinic' },
    restaurant: { className: 'restaurant' },
    market: { className: 'market' },
    workshop: { className: 'workshop' },
  };

  const elements = {
    connectionStatus: byId('connection-status'),
    lastUpdated: byId('last-updated'),
    themeToggle: byId('theme-toggle'),
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
    townMap: byId('town-map'),
    townMapOverlay: byId('town-map-overlay'),
    townAgentTotal: byId('town-agent-total'),
    townLocationInspector: byId('town-location-inspector'),
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

  function bindNavigation() {
    document.querySelectorAll('[data-view]').forEach((tab) => {
      tab.addEventListener('click', () => activateView(tab.dataset.view));
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
        next?.click();
      });
    });
    window.addEventListener('hashchange', () => {
      activateView(readViewFromLocation(), { updateLocation: false });
    });
  }

  function activateView(view, options = {}) {
    if (!viewTitles[view]) return;
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
    return viewTitles[requestedView] ? requestedView : 'overview';
  }

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
    elements.agentSearch.addEventListener('input', () => {
      state.agentSearch = elements.agentSearch.value.trim().toLowerCase();
      renderAgentTable();
    });
    elements.agentTable.addEventListener('click', handleAgentTableSelection);
    elements.agentTable.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        handleAgentTableSelection(event);
      }
    });
    document.querySelectorAll('[data-town-layer]').forEach((button) => {
      button.addEventListener('click', () => {
        state.townLayer = button.dataset.townLayer;
        renderTownMap();
      });
    });
    elements.townMapOverlay.addEventListener('click', handleTownMapSelection);
    elements.townLocationInspector.addEventListener('click', handleTownInspectorSelection);
    elements.locationsGrid.addEventListener('click', handleTownMapSelection);
    elements.cognitionAgentSelect.addEventListener('change', () => {
      selectAgent(elements.cognitionAgentSelect.value, { switchView: false });
    });
    elements.runtimeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitRuntimeAction('run');
    });
    elements.runtimeForm.querySelectorAll('[data-runtime-action]').forEach((button) => {
      if (button.dataset.runtimeAction === 'run') return;
      button.addEventListener(
        'click',
        () => void submitRuntimeAction(button.dataset.runtimeAction),
      );
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
  }

  function selectAgent(agentId, options) {
    if (!agentId) return;
    const nextLocationId = projection()?.agents?.[agentId]?.locationId;
    const agentChanged = agentId !== state.selectedAgentId;
    const locationChanged = nextLocationId && nextLocationId !== state.selectedLocationId;
    if (!agentChanged && !locationChanged) return;
    state.selectedAgentId = agentId;
    if (nextLocationId) state.selectedLocationId = nextLocationId;
    syncAgentSelectors();
    renderTown();
    renderCognition();
    void loadAgentCognition();
    if (options.switchView) activateView('cognition');
  }

  function handleTownMapSelection(event) {
    const location = event.target.closest('[data-location-id]');
    if (!location || location.dataset.locationId === state.selectedLocationId) return;
    state.selectedLocationId = location.dataset.locationId;
    renderTownMap();
    renderLocations();
  }

  function handleTownInspectorSelection(event) {
    const agent = event.target.closest('[data-agent-id]');
    if (agent) {
      selectAgent(agent.dataset.agentId, { switchView: false });
      document
        .querySelector('.town-directory')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!event.target.closest('[data-location-filter]')) return;
    state.agentSearch = state.selectedLocationId.toLowerCase();
    elements.agentSearch.value = state.selectedLocationId;
    renderAgentTable();
    document
      .querySelector('.town-directory')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
      renderPartitionOptions();
      if (!state.partition) {
        throw new Error('runtime status contains no simulation partitions');
      }
      await loadPartitionData();
      connectEventStream();
      renderAll();
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
    const tasks = {
      projectionEnvelope: loadOptional(`${base}/projection`, undefined),
      validationReports: loadOptional(`${base}/validation-reports?limit=20`, []),
      trades: loadOptional(`${base}/market-observations/trades?limit=50`, []),
      ohlcBars: loadOptional(`${base}/market-observations/ohlc-bars?limit=50`, []),
      steeringTraces: loadOptional(`${base}/steering-traces?limit=50`, []),
    };
    const results = await Promise.all(Object.values(tasks));
    Object.keys(tasks).forEach((key, index) => {
      state[key] = results[index];
    });

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
      renderCognition();
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
    renderCognition();
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

  function renderAll() {
    renderAccess();
    syncAgentSelectors();
    renderOverview();
    renderTown();
    renderMarket();
    renderCognition();
    renderSteering();
    renderPartialErrors();
  }

  function renderOverview() {
    const daemon = state.daemonStatus || {};
    const runtime = state.runtimeStatus || {};
    const world = projection() || {};
    const queueStats = daemon.components?.runQueue?.stats || {};
    const partition = runtime.partitions?.find(
      (candidate) =>
        candidate.simulationId === state.partition?.simulationId &&
        candidate.partitionKey === state.partition?.partitionKey,
    );
    const metrics = [
      metric(
        'Daemon health',
        daemon.health || 'unknown',
        `${runtime.healthyPartitionCount || 0}/${runtime.partitionCount || 0} partitions healthy`,
        daemon.health,
      ),
      metric(
        'Simulation clock',
        formatSimulationTime(world.clock?.now),
        `tick ${formatNumber(world.clock?.tickDurationMs, 0)} ms`,
      ),
      metric(
        'Population',
        formatNumber(Object.keys(world.agents || {}).length, 0),
        'manifest-seeded agents',
      ),
      metric(
        'Ready queue',
        formatNumber(queueStats.readyQueueCount || 0, 0),
        `${formatNumber(queueStats.statusCounts?.['dead-lettered'] || 0, 0)} dead-lettered`,
        queueStats.statusCounts?.['dead-lettered'] ? 'attention' : 'healthy',
      ),
    ];
    elements.overviewMetrics.classList.remove('skeleton-grid');
    elements.overviewMetrics.innerHTML = metrics.join('');
    elements.sloSummary.outerHTML = statusBadge(
      daemon.productionSlo?.status || 'not-observed',
      'slo-summary',
    );
    elements.sloSummary = byId('slo-summary');
    elements.sloTable.innerHTML = renderSloTable(daemon.productionSlo?.checks);
    elements.partitionTable.innerHTML = renderPartitionTable(runtime.partitions);
    elements.validationList.innerHTML = renderValidationReports(state.validationReports);
    if (partition?.lastValidationFailure) {
      elements.validationList.insertAdjacentHTML(
        'afterbegin',
        `<div class="record"><div class="record-head"><strong>Latest validation failure</strong>${statusBadge('failed')}</div><p>${escapeHtml(partition.lastValidationFailure.message || 'Unknown validation failure')}</p></div>`,
      );
    }
  }

  function renderTown() {
    renderTownMap();
    renderAgentTable();
    renderAgentDetail();
    renderLocations();
  }

  function renderTownMap() {
    const world = projection() || {};
    const agents = Object.values(world.agents || {});
    const locations = Object.values(world.locations || {}).filter(
      (location) => location.mapPosition || townMapLayout[location.locationId],
    );
    const locationIds = locations.map((location) => location.locationId);
    if (!locationIds.includes(state.selectedLocationId)) {
      state.selectedLocationId = locationIds.includes('school') ? 'school' : locationIds[0] || '';
    }

    document.querySelectorAll('[data-town-layer]').forEach((button) => {
      const active = button.dataset.townLayer === state.townLayer;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.townMap.dataset.layer = state.townLayer;
    elements.townAgentTotal.textContent = `${formatNumber(agents.length, 0)} Agents`;

    if (!locations.length) {
      elements.townMapOverlay.innerHTML = empty('No semantic locations found.');
      elements.townLocationInspector.innerHTML = empty(
        'The loaded projection does not contain town locations.',
      );
      return;
    }

    locations.sort((left, right) => {
      const leftPosition = left.mapPosition;
      const rightPosition = right.mapPosition;
      if (leftPosition && rightPosition) {
        return leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x;
      }
      return (
        Object.keys(townMapLayout).indexOf(left.locationId) -
        Object.keys(townMapLayout).indexOf(right.locationId)
      );
    });
    elements.townMapOverlay.innerHTML = `${renderTownRouteLayer(locations)}${locations
      .map((location) => renderTownHotspot(world, location))
      .join('')}`;
    renderTownLocationInspector(world);
  }

  function renderTownRouteLayer(locations) {
    const byLocationId = Object.fromEntries(
      locations.map((location) => [location.locationId, location]),
    );
    const renderedEdges = new Set();
    const lines = locations.flatMap((location) =>
      asArray(location.connections).flatMap((connection) => {
        const target = byLocationId[connection.targetLocationId];
        if (!location.mapPosition || !target?.mapPosition) return [];
        const edgeKey = [location.locationId, target.locationId].sort().join(':');
        if (renderedEdges.has(edgeKey)) return [];
        renderedEdges.add(edgeKey);
        return [
          `<line x1="${mapPercent(location.mapPosition.x)}" y1="${mapPercent(location.mapPosition.y)}" x2="${mapPercent(target.mapPosition.x)}" y2="${mapPercent(target.mapPosition.y)}"><title>${escapeHtml(`${location.name} ↔ ${target.name}: ${formatNumber(connection.travelDurationSeconds, 0)}s base travel`)}</title></line>`,
        ];
      }),
    );
    return lines.length
      ? `<svg class="town-route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Authoritative town travel routes">${lines.join('')}</svg>`
      : '';
  }

  function renderTownHotspot(world, location) {
    const layout = townMapLayout[location.locationId] || { className: location.kind };
    const residents = residentsAtLocation(world, location.locationId);
    const incomingTravelers = travelersToLocation(world, location.locationId);
    const selected = location.locationId === state.selectedLocationId;
    const activity = dominantLocationActivity(world, residents);
    const badgeDetail =
      state.townLayer === 'activity'
        ? activity
        : incomingTravelers.length > 0
          ? `present · +${incomingTravelers.length}`
          : 'present';
    const mapStyle = location.mapPosition
      ? ` style="--map-x:${mapPercent(location.mapPosition.x)};--map-y:${mapPercent(location.mapPosition.y)};--map-width:${mapPercent(location.mapPosition.width)};--map-height:${mapPercent(location.mapPosition.height)}"`
      : '';
    return `<button
      class="town-building town-building--${layout.className}${selected ? ' is-selected' : ''}"
      ${mapStyle}
      type="button"
      data-location-id="${escapeAttribute(location.locationId)}"
      aria-pressed="${selected}"
      aria-label="${escapeAttribute(`${location.name}, ${residents.length} present, ${activity}`)}"
    >
      <span class="town-building-badge">
        <span class="town-building-name">${escapeHtml(location.name)}</span>
        <span class="town-building-reading"><strong>${formatNumber(residents.length, 0)}</strong><small>${escapeHtml(badgeDetail)}</small></span>
      </span>
    </button>`;
  }

  function renderTownLocationInspector(world) {
    const location = world.locations?.[state.selectedLocationId];
    if (!location) {
      elements.townLocationInspector.innerHTML = empty(
        'Select a building to inspect current residents.',
      );
      return;
    }
    const residents = residentsAtLocation(world, location.locationId);
    const incomingTravelers = travelersToLocation(world, location.locationId);
    const capacity =
      location.capacity === null
        ? 'Open capacity'
        : `${formatNumber(location.capacity, 0)} capacity`;
    const connectionRows = asArray(location.connections)
      .map((connection) => {
        const targetName = world.locations?.[connection.targetLocationId]?.name;
        return `<span class="tag">${escapeHtml(targetName || connection.targetLocationId)} · ${formatNumber(connection.travelDurationSeconds, 0)}s</span>`;
      })
      .join('');
    const residentRows = residents.length
      ? residents
          .map((agent) => {
            const displayName = townAgentLabel(agent);
            const initials = displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.slice(0, 1))
              .join('')
              .toUpperCase();
            return `<button class="town-resident" type="button" data-agent-id="${escapeAttribute(agent.agentId)}">
              <span class="town-resident-avatar" aria-hidden="true">${escapeHtml(initials || 'A')}</span>
              <span class="town-resident-copy"><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(currentAgentActivity(world, agent))}</small></span>
              <span class="town-resident-cue">Inspect</span>
            </button>`;
          })
          .join('')
      : `<div class="town-resident-empty">No Agents are currently present.</div>`;
    elements.townLocationInspector.innerHTML = `
      <div class="town-inspector-head">
        <span class="eyebrow">${escapeHtml(location.kind)} place</span>
        <h2>${escapeHtml(location.name)}</h2>
        <p><strong>${formatNumber(residents.length, 0)}</strong> present · ${formatNumber(incomingTravelers.length, 0)} en route · ${escapeHtml(capacity)}</p>
      </div>
      <div class="town-inspector-section">
        <div class="town-inspector-label"><span>Current residents</span><span>${formatNumber(residents.length, 0)}</span></div>
        <div class="town-resident-list">${residentRows}</div>
      </div>
      <div class="town-inspector-section town-place-evidence">
        <span class="town-inspector-label">Activity affinities</span>
        <div class="tag-row">${asArray(location.activityAffinities)
          .map((affinity) => `<span class="tag">${escapeHtml(affinity)}</span>`)
          .join('')}</div>
        <p>${escapeHtml(location.source || 'Runtime projection')}</p>
      </div>
      <div class="town-inspector-section town-place-evidence">
        <span class="town-inspector-label">Incoming travelers</span>
        <div class="tag-row">${
          incomingTravelers.length
            ? incomingTravelers
                .map(
                  (transit) =>
                    `<span class="tag">${escapeHtml(townAgentLabel(world.agents?.[transit.agentId] || { agentId: transit.agentId }))} · arrives t=${formatNumber(transit.arrivesAt, 0)}</span>`,
                )
                .join('')
            : '<span class="tag">None</span>'
        }</div>
      </div>
      <div class="town-inspector-section town-place-evidence">
        <span class="town-inspector-label">Direct travel routes</span>
        <div class="tag-row">${connectionRows || '<span class="tag">Legacy direct movement</span>'}</div>
        <p>${escapeHtml(location.mapPosition ? `Map position ${mapPercent(location.mapPosition.x)}, ${mapPercent(location.mapPosition.y)}` : 'No authoritative map coordinate')}</p>
      </div>
      <button class="town-directory-link" type="button" data-location-filter>
        Show residents in directory
      </button>`;
  }

  function residentsAtLocation(world, locationId) {
    return Object.values(world.agents || {})
      .filter((agent) => agent.locationId === locationId)
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
  }

  function travelersToLocation(world, locationId) {
    return Object.values(world.transitByAgent || {})
      .filter((transit) => transit.toLocationId === locationId)
      .sort((left, right) => left.arrivesAt - right.arrivesAt);
  }

  function mapPercent(value) {
    const number = Number(value);
    return `${Math.round(Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0)) * 10000) / 100}%`;
  }

  function currentAgentActivity(world, agent) {
    const transit = world.transitByAgent?.[agent.agentId];
    if (transit) {
      return `Traveling → ${world.locations?.[transit.toLocationId]?.name || transit.toLocationId}`;
    }
    return world.activityTimeByAgent?.[agent.agentId]?.activity || 'Idle';
  }

  function townAgentLabel(agent) {
    if (agent.registration?.displayName) return agent.registration.displayName;
    const numericSuffix = /agent-(\d+)$/u.exec(agent.agentId)?.[1];
    return numericSuffix ? `Agent ${numericSuffix}` : agent.agentId;
  }

  function dominantLocationActivity(world, residents) {
    if (!residents.length) return 'Idle';
    const counts = residents.reduce((result, agent) => {
      const activity = currentAgentActivity(world, agent);
      result[activity] = (result[activity] || 0) + 1;
      return result;
    }, {});
    return Object.entries(counts).sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    )[0][0];
  }

  function renderAgentTable() {
    const agents = Object.values(projection()?.agents || {}).filter((agent) => {
      if (!state.agentSearch) return true;
      return [
        agent.agentId,
        agent.registration?.displayName,
        agent.registration?.creatorId,
        agent.job,
        agent.locationId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(state.agentSearch));
    });
    if (!agents.length) {
      elements.agentTable.innerHTML = empty('No agents match this view.');
      return;
    }
    elements.agentTable.innerHTML = table(
      ['Agent', 'Location', 'Job', 'Education', 'Balance', 'Energy', 'Health'],
      agents.map((agent) => {
        const selected = agent.agentId === state.selectedAgentId;
        return `<tr class="agent-row${selected ? ' is-selected' : ''}" tabindex="0" data-agent-id="${escapeAttribute(agent.agentId)}" aria-selected="${selected}">
          <td><span class="mono">${escapeHtml(agent.agentId)}</span>${agent.registration?.displayName ? `<br><span class="record-meta">${escapeHtml(agent.registration.displayName)}</span>` : ''}</td>
          <td>${escapeHtml(agent.locationId || '—')}</td>
          <td>${escapeHtml(agent.job || 'Unemployed')}</td>
          <td class="numeric">${formatNumber(agent.educationScore, 1)}</td>
          <td class="numeric">${formatNumber(agent.balance, 2)}</td>
          <td>${progressCell(agent.physiology?.energy)}</td>
          <td>${progressCell(agent.physiology?.health)}</td>
        </tr>`;
      }),
    );
  }

  function renderAgentDetail() {
    const world = projection() || {};
    const agent = world.agents?.[state.selectedAgentId];
    if (!agent) {
      elements.agentDetailTitle.textContent = 'None';
      elements.agentDetail.innerHTML = empty(
        'Select an agent to inspect physiology, inventory and current activity.',
      );
      return;
    }
    const activity = world.activityTimeByAgent?.[agent.agentId];
    const transit = world.transitByAgent?.[agent.agentId];
    const inventory = Object.entries(agent.inventory || {});
    elements.agentDetailTitle.textContent = agent.agentId;
    elements.agentDetail.innerHTML = `
      <div class="detail-grid">
        ${detailStat('Energy', formatNumber(agent.physiology?.energy, 1))}
        ${detailStat('Satiety', formatNumber(agent.physiology?.satiety, 1))}
        ${detailStat('Health', formatNumber(agent.physiology?.health, 1))}
        ${detailStat('Education', formatNumber(agent.educationScore, 1))}
      </div>
      <dl class="property-list">
        ${property('Location', agent.locationId || '—')}
        ${property('Travel', transit ? `${transit.fromLocationId} → ${transit.toLocationId}, arrives t=${formatNumber(transit.arrivesAt, 0)}` : 'Not in transit')}
        ${property('Occupation', agent.job || 'Unemployed')}
        ${property('Residential tier', formatNumber(agent.residentialTier, 0))}
        ${property('Balance', formatNumber(agent.balance, 2))}
        ${property('Origin', agent.registration ? `${agent.registration.provenance} · ${agent.registration.policyVersion}` : 'initial manifest')}
        ${property('Creator attribution', agent.registration?.creatorId || '—')}
        ${property('Activity', activity ? `${activity.activity} until t=${formatNumber(activity.availableAt, 0)}` : 'Idle')}
        ${property('Inventory', inventory.length ? inventory.map(([key, value]) => `${key}: ${formatNumber(value, 2)}`).join(', ') : 'Empty')}
      </dl>`;
  }

  function renderLocations() {
    const world = projection() || {};
    const locations = Object.values(world.locations || {});
    if (!locations.length) {
      elements.locationsGrid.innerHTML = empty('No locations found.');
      return;
    }
    const occupancy = {};
    Object.values(world.agents || {}).forEach((agent) => {
      if (agent.locationId) occupancy[agent.locationId] = (occupancy[agent.locationId] || 0) + 1;
    });
    elements.locationsGrid.innerHTML = locations
      .map((location) => {
        const count = occupancy[location.locationId] || 0;
        const incomingCount = travelersToLocation(world, location.locationId).length;
        const capacity =
          location.capacity === null ? 'unbounded' : formatNumber(location.capacity, 0);
        const selected = location.locationId === state.selectedLocationId;
        return `<button class="location-tile${selected ? ' is-selected' : ''}" type="button" data-location-id="${escapeAttribute(location.locationId)}" aria-pressed="${selected}">
          <div class="location-title"><strong>${escapeHtml(location.name)}</strong><span class="tag">${escapeHtml(location.kind)}</span></div>
          <div class="location-meta"><span class="mono">${escapeHtml(location.locationId)}</span><br>${count} present · ${incomingCount} en route · capacity ${capacity}<br>${escapeHtml(asArray(location.activityAffinities).join(', ') || 'No activity affinities')}</div>
        </button>`;
      })
      .join('');
  }

  function renderMarket() {
    const world = projection() || {};
    const pools = Object.values(world.marketPools || {});
    const latestIndex = asArray(world.marketPriceIndices).at(-1);
    elements.marketMetrics.innerHTML = [
      metric('Money supply', formatNumber(world.moneySupply, 2), 'simulation currency'),
      metric('AMM pools', pools.length, `${state.trades.length} recent trades`),
      metric(
        'Overall index',
        latestIndex ? formatNumber(latestIndex.overall, 3) : '—',
        latestIndex ? `recorded t=${formatNumber(latestIndex.recordedAt, 0)}` : 'not observed',
      ),
      metric(
        'Trade volume',
        formatNumber(
          state.trades.reduce((sum, trade) => sum + numberOrZero(trade.currencyQuantity), 0),
          2,
        ),
        'currency in loaded window',
      ),
    ].join('');
    elements.poolTable.innerHTML = renderPools(pools);
    elements.priceIndexList.innerHTML = renderPriceIndices(world.marketPriceIndices);
    elements.tradeTable.innerHTML = renderTrades(state.trades);
    elements.ohlcTable.innerHTML = renderOhlc(state.ohlcBars);
  }

  function renderCognition() {
    const agentId = state.selectedAgentId;
    elements.cognitionAgentLabel.textContent = agentId || 'No agent selected';
    elements.planCount.textContent = String(state.plans.length);
    elements.planTree.innerHTML = renderPlans(state.plans, agentId);
    elements.profileDetail.innerHTML = renderProfile(state.profile, agentId);
    elements.cycleTraces.innerHTML = renderCycleTraces(state.cycleTraces, agentId);
    elements.objectiveTraces.innerHTML = renderObjectiveTraces(state.objectiveTraces);
    elements.dailyTraces.innerHTML = renderDailyTraces(state.dailyTraces);
  }

  function renderSteering() {
    elements.steeringTraces.innerHTML = renderSteeringTraces(state.steeringTraces);
  }

  function renderAccess() {
    const session = state.accessSession;
    const policy = session?.policy;
    const authentication = session?.authentication;
    const principal = authentication?.principal;
    const roles = asArray(principal?.roles);
    const mode = policy?.mode;
    const authenticated = Boolean(authentication?.authenticated);

    elements.accessStatus.className = 'status-badge';
    if (!session) {
      elements.accessStatus.classList.add('status-attention');
      elements.accessStatus.textContent = 'Credential error';
      elements.accessDetail.innerHTML = `<p>${escapeHtml(state.accessError || 'Access policy is unavailable.')}</p>`;
      elements.accessTokenForm.hidden = false;
    } else if (mode === 'open') {
      elements.accessStatus.classList.add('status-warning');
      elements.accessStatus.textContent = 'Local open mode';
      elements.accessDetail.innerHTML =
        '<p><strong>Loopback-only local mode.</strong> Mutations are unrestricted and creator IDs are provenance labels, not authenticated identities.</p>';
      elements.accessTokenForm.hidden = true;
    } else if (authenticated) {
      elements.accessStatus.classList.add('status-healthy');
      elements.accessStatus.textContent = 'Authenticated';
      const registrationRate = policy?.mutationRateLimits?.registration;
      const steeringRate = policy?.mutationRateLimits?.steering;
      const rateLimits =
        registrationRate && steeringRate
          ? `${registrationRate.limit}/hour registration · ${steeringRate.limit}/minute steering`
          : '—';
      elements.accessDetail.innerHTML = `<div class="detail-grid">${property('Subject', principal?.subjectId || '—')}${property('Roles', roles.join(', ') || '—')}${property('Agent quota', policy?.maxAgentsPerParticipant ?? '—')}${property('Ownership', 'Owner or operator')}${property('Consent policy', policy?.consentPolicyVersion || '—')}${property('Consent accepted', state.acceptedConsentPolicyVersion === policy?.consentPolicyVersion ? 'Current tab' : 'Required')}${property('Rate limits', rateLimits)}${property('Rate-limit authority', policy?.rateLimitAuthority || '—')}</div>`;
      elements.accessTokenForm.hidden = false;
    } else {
      elements.accessStatus.classList.add('status-attention');
      elements.accessStatus.textContent = 'Sign-in required';
      elements.accessDetail.innerHTML =
        '<p>Public reads remain available. Agent creation and steering require a participant token; runtime controls require an operator token.</p>';
      elements.accessTokenForm.hidden = false;
    }

    const open = mode === 'open';
    const participant = roles.includes('participant');
    const operator = roles.includes('operator');
    const participantMutationAllowed = open || (authenticated && (participant || operator));
    const operatorMutationAllowed = open || (authenticated && operator);
    setFormEnabled(elements.agentRegistrationForm, participantMutationAllowed);
    setFormEnabled(elements.objectiveForm, participantMutationAllowed);
    setFormEnabled(elements.reactiveForm, participantMutationAllowed);
    setFormEnabled(elements.runtimeForm, operatorMutationAllowed);
    setFormEnabled(elements.replayForm, operatorMutationAllowed);

    elements.creatorAttributionField.hidden = mode === 'authenticated';
    const creatorInput = elements.agentRegistrationForm.elements.creatorId;
    creatorInput.required = mode !== 'authenticated';
    creatorInput.disabled = mode === 'authenticated' || !participantMutationAllowed;
  }

  function setFormEnabled(form, enabled) {
    [...form.elements].forEach((control) => {
      control.disabled = !enabled;
    });
  }

  function renderSloTable(checks) {
    const records = asArray(checks);
    if (!records.length) return empty('No production SLO snapshot is available.');
    return table(
      ['Check', 'Status', 'Objective', 'Violations'],
      records.map(
        (check) => `<tr>
        <td class="mono">${escapeHtml(check.checkId)}</td>
        <td>${statusBadge(check.status)}</td>
        <td>${escapeHtml(check.objective)}</td>
        <td>${escapeHtml(asArray(check.violations).join('; ') || 'None')}</td>
      </tr>`,
      ),
    );
  }

  function renderPartitionTable(partitions) {
    const records = asArray(partitions);
    if (!records.length) return empty('No partition status.');
    return table(
      ['Simulation', 'Partition', 'Status', 'Health', 'Agents', 'Sequence', 'Validation'],
      records.map(
        (partition) => `<tr>
        <td class="mono">${escapeHtml(partition.simulationId)}</td>
        <td class="mono">${escapeHtml(partition.partitionKey)}</td>
        <td>${statusBadge(partition.status)}</td>
        <td>${statusBadge(partition.health)}</td>
        <td class="numeric">${formatNumber(numberOrZero(partition.seededAgentCount) + numberOrZero(partition.skippedAgentCount), 0)}</td>
        <td class="numeric">${formatNumber(partition.lastAppliedSequence, 0)}</td>
        <td>${statusBadge(partition.lastValidationStatus || 'not-run')}</td>
      </tr>`,
      ),
    );
  }

  function renderValidationReports(reports) {
    if (!reports.length) return empty('No validation reports in this partition.');
    return reports
      .map((report) => {
        const metrics = asArray(report.metrics);
        const failures = metrics.filter((metricItem) => metricItem.status === 'fail').length;
        const watches = metrics.filter((metricItem) => metricItem.status === 'watch').length;
        const status = failures ? 'fail' : watches ? 'watch' : 'pass';
        return `<div class="record"><div class="record-head"><strong>${escapeHtml(report.run?.runId || 'validation run')}</strong>${statusBadge(status)}</div><p>${metrics.length} metrics · ${asArray(report.findings).length} findings</p><div class="record-meta"><span>generated t=${formatNumber(report.run?.generatedAt, 0)}</span><span>${escapeHtml(report.run?.source || 'local runtime')}</span></div></div>`;
      })
      .join('');
  }

  function renderPools(pools) {
    if (!pools.length) return empty('No pools in this partition.');
    return table(
      ['Commodity', 'Commodity reserve', 'Currency reserve', 'Spot price', 'Invariant'],
      pools.map((pool) => {
        const commodity = numberOrZero(pool.commodityReserve);
        const currency = numberOrZero(pool.currencyReserve);
        return `<tr><td>${escapeHtml(pool.commodity)}</td><td class="numeric">${formatNumber(commodity, 2)}</td><td class="numeric">${formatNumber(currency, 2)}</td><td class="numeric">${commodity > 0 ? formatNumber(currency / commodity, 4) : '—'}</td><td class="numeric">${formatNumber(commodity * currency, 2)}</td></tr>`;
      }),
    );
  }

  function renderPriceIndices(indices) {
    const records = asArray(indices).slice(-8).reverse();
    if (!records.length) return empty('No index observations.');
    const max = Math.max(
      1,
      ...records.flatMap((entry) => [entry.food, entry.nonFood, entry.overall].map(numberOrZero)),
    );
    return records
      .map(
        (
          entry,
        ) => `<div class="record"><div class="record-head"><strong>t=${formatNumber(entry.recordedAt, 0)}</strong><span class="mono">overall ${formatNumber(entry.overall, 3)}</span></div>
      ${indexRow('Food', entry.food, max)}${indexRow('Non-food', entry.nonFood, max)}
    </div>`,
      )
      .join('');
  }

  function indexRow(label, value, max) {
    const width = Math.max(0, Math.min(100, (numberOrZero(value) / max) * 100));
    return `<div class="index-row"><span>${escapeHtml(label)}</span><div class="index-bar"><span class="${widthClass(width)}"></span></div><span class="mono">${formatNumber(value, 3)}</span></div>`;
  }

  function renderTrades(trades) {
    if (!trades.length) return empty('No trades recorded.');
    return table(
      ['Time', 'Commodity', 'Side', 'Price', 'Quantity', 'Currency'],
      trades.map(
        (trade) =>
          `<tr><td class="mono">t=${formatNumber(trade.observedAt, 0)}</td><td>${escapeHtml(trade.commodityId)}</td><td>${statusBadge(trade.side)}</td><td class="numeric">${formatNumber(trade.price, 4)}</td><td class="numeric">${formatNumber(trade.commodityQuantity, 3)}</td><td class="numeric">${formatNumber(trade.currencyQuantity, 3)}</td></tr>`,
      ),
    );
  }

  function renderOhlc(bars) {
    if (!bars.length) return empty('No OHLC bars recorded.');
    return table(
      ['Interval', 'Commodity', 'Open', 'High', 'Low', 'Close', 'Trades'],
      bars.map(
        (bar) =>
          `<tr><td class="mono">${formatNumber(bar.intervalStartedAt, 0)}–${formatNumber(bar.intervalEndedAt, 0)}</td><td>${escapeHtml(bar.commodityId)}</td><td class="numeric">${formatNumber(bar.openPrice, 4)}</td><td class="numeric">${formatNumber(bar.highPrice, 4)}</td><td class="numeric">${formatNumber(bar.lowPrice, 4)}</td><td class="numeric">${formatNumber(bar.closePrice, 4)}</td><td class="numeric">${formatNumber(bar.tradeCount, 0)}</td></tr>`,
      ),
    );
  }

  function renderPlans(plans, agentId) {
    if (!agentId) return empty('Select an agent to load durable plans.');
    if (!plans.length) return empty('No durable branch plan exists for this agent.');
    return plans
      .map(
        (record) => `<div class="plan-record">
      <div class="record-head"><span class="mono">${escapeHtml(record.planId)}</span>${statusBadge(record.planningTrace?.status || 'deterministic')}</div>
      <div class="plan-objective">${escapeHtml(record.plan?.objective || 'Untitled objective')}</div>
      ${asArray(record.plan?.branches)
        .map(
          (branch) =>
            `<div class="branch"><div class="branch-title">${escapeHtml(branch.id)}</div><div class="branch-objective">${escapeHtml(branch.objective)}</div>${asArray(
              branch.subtasks,
            )
              .map(
                (subtask) =>
                  `<div class="subtask"><span class="subtask-priority">${formatNumber(subtask.basePriority, 1)}</span><span><strong>${escapeHtml(subtask.id)}</strong><br>${escapeHtml(subtask.description)}</span></div>`,
              )
              .join('')}</div>`,
        )
        .join('')}
      <div class="record-meta"><span>updated t=${formatNumber(record.updatedAt, 0)}</span><span>${escapeHtml(record.strategicContext?.policyVersion || 'no strategic context')}</span>${record.revision ? `<span>revision: ${escapeHtml(record.revision.trigger)}</span>` : ''}</div>
    </div>`,
      )
      .join('');
  }

  function renderProfile(profile, agentId) {
    if (!agentId) return empty('Select an agent to inspect profile memory.');
    if (!profile) return empty('No long-term profile was returned for this agent.');
    const sections = ['beliefs', 'habits', 'mood', 'values', 'personality', 'socialRecords'];
    return sections
      .map((section) => {
        const entries = asArray(profile[section]);
        return `<section class="profile-section"><h3>${escapeHtml(splitWords(section))} · ${entries.length}</h3><div class="tag-list">${entries.length ? entries.map((entry) => `<span class="tag" title="confidence ${formatNumber(entry.confidence, 2)} · ${escapeAttribute(entry.statement)}">${escapeHtml(entry.key)}</span>`).join('') : '<span class="muted">No entries</span>'}</div></section>`;
      })
      .join('');
  }

  function renderCycleTraces(traces, agentId) {
    if (!agentId) return empty('Select an agent to inspect planner traces.');
    if (!traces.length)
      return empty('No cycle traces for this agent. Run the simulation to produce evidence.');
    return traces
      .map((trace) => {
        const stageStatuses = [
          trace.contextualPrioritization?.status,
          ...asArray(trace.actionSequenceGeneration).map((item) => item.status),
          trace.globalSynthesis?.status,
          trace.replanningDecisionTrace?.status,
        ].filter(Boolean);
        const overall = stageStatuses.includes('fallback')
          ? 'fallback'
          : stageStatuses.includes('accepted')
            ? 'accepted'
            : 'deterministic';
        return `<div class="trace-card"><div><div class="trace-title mono">${escapeHtml(trace.traceId)}</div><div class="record-meta"><span>t=${formatNumber(trace.cycleStartedAt, 0)}</span><span>${escapeHtml(trace.selectedBranch)}</span></div></div><div><div class="trace-summary">${escapeHtml(trace.observedStateSummary)}</div><div class="trace-evidence"><span class="tag">${asArray(trace.subtaskCandidates).length} subtasks</span><span class="tag">${asArray(trace.candidateActions).length} actions</span><span class="tag">${asArray(trace.emittedCommandIds).length} commands</span><span class="tag">replan ${escapeHtml(trace.replanningDecision)}</span></div></div>${statusBadge(overall)}</div>`;
      })
      .join('');
  }

  function renderObjectiveTraces(traces) {
    if (!traces.length) return empty('No objective renewal traces.');
    return traces
      .map(
        (trace) =>
          `<div class="record"><div class="record-head"><strong>${escapeHtml(trace.selectedCandidateId || trace.objectiveId)}</strong>${statusBadge(trace.strategicPlan?.status || 'deterministic')}</div><p>${escapeHtml(trace.rationale || 'No rationale recorded.')}</p><div class="record-meta"><span class="mono">${escapeHtml(trace.objectiveId)}</span><span>score ${formatNumber(trace.score, 2)}</span><span>t=${formatNumber(trace.issuedAt, 0)}</span></div></div>`,
      )
      .join('');
  }

  function renderDailyTraces(traces) {
    if (!traces.length) return empty('No daily plan renewal traces.');
    return traces
      .map(
        (trace) =>
          `<div class="record"><div class="record-head"><strong>${escapeHtml(trace.dailyPlanId)}</strong>${statusBadge(trace.planningTrace?.status || 'deterministic')}</div><p>${asArray(trace.scheduledIntentionIds).length} scheduled intentions from ${asArray(trace.shortTermMemoryContextIds).length} short-term memories.</p><div class="record-meta"><span>${asArray(trace.profileEntryKeys).length} profile entries</span><span>t=${formatNumber(trace.issuedAt, 0)}</span></div></div>`,
      )
      .join('');
  }

  function renderSteeringTraces(traces) {
    if (!traces.length)
      return empty(
        'No steering traces recorded. Submit a command, then run a cycle to produce execution evidence.',
      );
    return traces
      .map(
        (trace) =>
          `<div class="trace-card"><div><div class="trace-title mono">${escapeHtml(trace.traceId)}</div><div class="record-meta"><span>${escapeHtml(trace.agentId)}</span><span>t=${formatNumber(trace.issuedAt, 0)}</span></div></div><div><div class="trace-summary">${escapeHtml(trace.objectiveStatement || trace.reactiveCommandId || trace.commandType)}</div><div class="trace-evidence"><span class="tag">${escapeHtml(trace.resultKind)}</span><span class="tag">${formatNumber(trace.candidateActionCount, 0)} candidates</span><span class="tag">${formatNumber(trace.commandDraftCount, 0)} drafts</span><span class="tag">${asArray(trace.shortTermMemoryRecordIds).length} memories</span>${trace.selectedPlannerDomain ? `<span class="tag">${escapeHtml(trace.selectedPlannerDomain)}</span>` : ''}</div></div>${statusBadge(trace.strategicPlan?.status || 'accepted')}</div>`,
      )
      .join('');
  }

  function syncAgentSelectors() {
    const agentIds = Object.keys(projection()?.agents || {}).sort();
    const cognitionOptions = createAgentOptions(agentIds, state.selectedAgentId);
    elements.cognitionAgentSelect.innerHTML = cognitionOptions;
    const manageableIds = resolveManageableAgentIds(agentIds);
    const steeringOptions = createAgentOptions(manageableIds, state.selectedAgentId);
    [elements.objectiveForm, elements.reactiveForm].forEach((form) => {
      const select = form.elements.agentId;
      const previous = select.value || state.selectedAgentId;
      select.innerHTML = steeringOptions;
      if (manageableIds.includes(previous)) select.value = previous;
    });
  }

  function createAgentOptions(agentIds, selectedAgentId) {
    return `<option value="">Select an agent</option>${agentIds.map((agentId) => `<option value="${escapeAttribute(agentId)}"${agentId === selectedAgentId ? ' selected' : ''}>${escapeHtml(agentId)}</option>`).join('')}`;
  }

  function resolveManageableAgentIds(agentIds) {
    const session = state.accessSession;
    if (session?.policy?.mode !== 'authenticated') return agentIds;
    const principal = session.authentication?.principal;
    const roles = asArray(principal?.roles);
    if (roles.includes('operator')) return agentIds;
    if (!roles.includes('participant') || !principal?.subjectId) return [];
    const agents = projection()?.agents || {};
    return agentIds.filter(
      (agentId) => agents[agentId]?.registration?.creatorId === principal.subjectId,
    );
  }

  function renderPartitionOptions() {
    const partitions = asArray(state.runtimeStatus?.partitions);
    if (!partitions.length) {
      elements.partitionSelect.innerHTML = '<option>No partitions</option>';
      elements.partitionSelect.disabled = true;
      return;
    }
    elements.partitionSelect.disabled = false;
    elements.partitionSelect.innerHTML = partitions
      .map((partition) => {
        const selected =
          partition.simulationId === state.partition?.simulationId &&
          partition.partitionKey === state.partition?.partitionKey;
        return `<option data-simulation-id="${escapeAttribute(partition.simulationId)}" data-partition-key="${escapeAttribute(partition.partitionKey)}"${selected ? ' selected' : ''}>${escapeHtml(partition.simulationId)} / ${escapeHtml(partition.partitionKey)}</option>`;
      })
      .join('');
  }

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
    const isParticipantMutation =
      /\/partitions\/[^/]+\/(agents|objectives|reactive-commands)$/u.test(path);
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
    renderAccess();
    syncAgentSelectors();
    if (accessSession?.authentication?.authenticated) {
      showActionResult(
        elements.accessResult,
        `Authenticated as ${accessSession.authentication.principal.subjectId}.`,
        true,
      );
    } else {
      showActionResult(
        elements.accessResult,
        state.accessError || 'Token was not accepted.',
        false,
      );
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
    renderSteering();
  }

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
    elements.connectionStatus.className = `status-badge ${statusClass(status)}`;
    elements.connectionStatus.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${escapeHtml(splitWords(status))}`;
  }

  function renderPartialErrors() {
    if (!state.partialErrors.length) {
      elements.globalAlert.hidden = true;
      return;
    }
    elements.globalAlert.hidden = false;
    elements.globalAlert.className = 'alert';
    elements.globalAlert.textContent = `${state.partialErrors.length} optional evidence source(s) were unavailable. Other live data remains visible.`;
    elements.globalAlert.title = state.partialErrors.join('\n');
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

  function metric(label, value, foot, status) {
    return `<div class="metric"><div class="metric-label"><span>${escapeHtml(label)}</span>${status ? `<span class="trend ${trendClass(status)}">${escapeHtml(splitWords(status))}</span>` : ''}</div><strong class="metric-value">${escapeHtml(String(value))}</strong><span class="metric-foot">${escapeHtml(foot || '')}</span></div>`;
  }

  function detailStat(label, value) {
    return `<div class="detail-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function property(label, value) {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
  }

  function progressCell(value) {
    const numeric = Math.max(0, Math.min(100, numberOrZero(value)));
    const tone = numeric < 25 ? 'bad' : numeric < 50 ? 'warn' : 'good';
    return `<div class="progress ${tone}" title="${formatNumber(value, 1)}"><span class="${widthClass(numeric)}"></span></div>`;
  }

  function widthClass(value) {
    return `w-${Math.round(Math.max(0, Math.min(100, numberOrZero(value))) / 5) * 5}`;
  }

  function table(headers, rows) {
    return `<table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function empty(message) {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function statusBadge(status, id) {
    const text = splitWords(status || 'unknown');
    return `<span${id ? ` id="${escapeAttribute(id)}"` : ''} class="status-badge ${statusClass(status)}">${escapeHtml(text)}</span>`;
  }

  function statusClass(status) {
    const normalized = String(status || 'neutral').toLowerCase();
    const safe = [
      'healthy',
      'succeeded',
      'accepted',
      'completed',
      'started',
      'running',
      'degraded',
      'fallback',
      'warning',
      'watch',
      'paused',
      'bootstrapped',
      'attention',
      'failed',
      'fail',
      'error',
      'dead-lettered',
      'deterministic',
      'neutral',
      'idle',
      'pass',
      'not-applicable',
      'not-observed',
      'not-run',
    ];
    if (normalized === 'pass') return 'status-healthy';
    if (normalized === 'fail') return 'status-failed';
    if (normalized === 'watch') return 'status-warning';
    if (normalized.startsWith('not-')) return 'status-neutral';
    return safe.includes(normalized) ? `status-${normalized}` : 'status-neutral';
  }

  function trendClass(status) {
    if (['healthy', 'pass', 'succeeded', 'accepted'].includes(status)) return 'good';
    if (['attention', 'failed', 'fail', 'error'].includes(status)) return 'bad';
    return 'warn';
  }

  function formatSimulationTime(value) {
    if (!Number.isFinite(Number(value))) return '—';
    const numeric = Number(value);
    const totalSeconds = Math.floor(numeric / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
  }

  function formatNumber(value, digits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits > 0 ? Math.min(1, digits) : 0,
    }).format(numeric);
  }

  function numberOrZero(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function splitWords(value) {
    return String(value || 'unknown')
      .replaceAll('-', ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function readErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
  }
})();

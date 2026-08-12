/**
 * Workspace overlay panels: the five drill-down workspaces (Mission control,
 * Population, Economy, Cognition, Interventions) migrated from the previous
 * single-file app.js. DOM IDs, API paths and data semantics are unchanged;
 * only the module boundary is new. Pure HTML/format helpers live here and are
 * shared with `inspector.js` and `app.js` (import direction is one-way:
 * nothing here imports the entry module).
 */

// ---------------------------------------------------------------------------
// Pure formatting / HTML helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function splitWords(value) {
  return String(value || 'unknown')
    .replaceAll('-', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(1, digits) : 0,
  }).format(numeric);
}

export function formatSimulationTime(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  const totalSeconds = Math.floor(numeric / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

export function mapPercent(value) {
  const number = Number(value);
  return `${Math.round(Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0)) * 10000) / 100}%`;
}

export function empty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function table(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function statusBadge(status, id) {
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

export function metric(label, value, foot, status) {
  return `<div class="metric"><div class="metric-label"><span>${escapeHtml(label)}</span>${status ? `<span class="trend ${trendClass(status)}">${escapeHtml(splitWords(status))}</span>` : ''}</div><strong class="metric-value">${escapeHtml(String(value))}</strong><span class="metric-foot">${escapeHtml(foot || '')}</span></div>`;
}

export function detailStat(label, value) {
  return `<div class="detail-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

export function property(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
}

function widthClass(value) {
  return `w-${Math.round(Math.max(0, Math.min(100, numberOrZero(value))) / 5) * 5}`;
}

export function progressCell(value) {
  const numeric = Math.max(0, Math.min(100, numberOrZero(value)));
  const tone = numeric < 25 ? 'bad' : numeric < 50 ? 'warn' : 'good';
  return `<div class="progress ${tone}" title="${formatNumber(value, 1)}"><span class="${widthClass(numeric)}"></span></div>`;
}

function indexRow(label, value, max) {
  const width = Math.max(0, Math.min(100, (numberOrZero(value) / max) * 100));
  return `<div class="index-row"><span>${escapeHtml(label)}</span><div class="index-bar"><span class="${widthClass(width)}"></span></div><span class="mono">${formatNumber(value, 3)}</span></div>`;
}

export function setFormEnabled(form, enabled) {
  [...form.elements].forEach((control) => {
    control.disabled = !enabled;
  });
}

// ---------------------------------------------------------------------------
// Town projection helpers (shared with the inspector panel)
// ---------------------------------------------------------------------------

export function residentsAtLocation(world, locationId) {
  return Object.values(world.agents || {})
    .filter((agent) => agent.locationId === locationId)
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
}

export function travelersToLocation(world, locationId) {
  return Object.values(world.transitByAgent || {})
    .filter((transit) => transit.toLocationId === locationId)
    .sort((left, right) => left.arrivesAt - right.arrivesAt);
}

export function currentAgentActivity(world, agent) {
  const transit = world.transitByAgent?.[agent.agentId];
  if (transit) {
    return `Traveling → ${world.locations?.[transit.toLocationId]?.name || transit.toLocationId}`;
  }
  return world.activityTimeByAgent?.[agent.agentId]?.activity || 'Idle';
}

export function townAgentLabel(agent) {
  if (agent.registration?.displayName) return agent.registration.displayName;
  const numericSuffix = /agent-(\d+)$/u.exec(agent.agentId)?.[1];
  return numericSuffix ? `Agent ${numericSuffix}` : agent.agentId;
}

// ---------------------------------------------------------------------------
// Workspace panels
// ---------------------------------------------------------------------------

/**
 * @param ctx {{
 *   state: object,
 *   elements: Record<string, HTMLElement>,
 *   byId: (id: string) => HTMLElement,
 *   projection: () => object|undefined,
 *   townProjection: () => object|undefined,
 * }}
 */
export function createWorkspaces(ctx) {
  const { state, elements, byId, projection, townProjection } = ctx;

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

  // -- Mission control -------------------------------------------------------

  function renderOverview() {
    const daemon = state.daemonStatus || {};
    const runtime = state.runtimeStatus || {};
    const world = projection() || {};
    const society = state.societyProjection;
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
        society ? 'Town population' : 'Partition population',
        formatNumber(
          society?.population?.totalAgentCount ?? Object.keys(world.agents || {}).length,
          0,
        ),
        society
          ? `${formatNumber(asArray(society.population?.owners).length, 0)} owner partitions`
          : 'society projection unavailable',
      ),
      metric(
        'Market scope',
        society?.market?.status === 'unified-authority'
          ? 'Unified authority'
          : society?.market?.status === 'regional-authority'
            ? 'Regional authority'
            : society?.market?.status === 'consistent-replica'
              ? 'Shared replica'
              : society?.market?.status === 'partitioned'
                ? 'Partitioned'
                : 'Not observed',
        society?.market?.status === 'unified-authority'
          ? 'One global pool settled by the simulation-wide authority'
          : society?.market?.status === 'regional-authority'
            ? 'One authority, per-region pools with divergent prices'
            : society?.market?.status === 'partitioned'
              ? 'Prices are not yet a simulation-wide authority'
              : society?.market?.status === 'consistent-replica'
                ? 'All visible partition replicas agree at this boundary'
                : 'load the society projection to verify',
        society?.market?.status === 'partitioned' ? 'attention' : 'healthy',
      ),
      ...(society?.authority
        ? [
            metric(
              'Authority ledger',
              `rev ${formatNumber(society.authority.revision, 0)}`,
              `fencing token ${formatNumber(society.authority.latestFencingToken, 0)} · ${formatSimulationTime(society.authority.simulationTime)}`,
              'healthy',
            ),
          ]
        : []),
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

  // -- Population ------------------------------------------------------------

  function renderTown() {
    renderAgentTable();
    renderAgentDetail();
    renderLocations();
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
    const world = townProjection() || {};
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

  // -- Economy ---------------------------------------------------------------

  function renderMarket() {
    const world = projection() || {};
    const society = state.societyProjection;
    // Under the simulation-wide authority the partition projection's pools
    // only reflect this partition's own trades. Prefer the authoritative pool
    // view (unified or per-region) so the market page shows settlement truth.
    const marketStatus = society?.market?.status;
    const authorityPools =
      marketStatus === 'unified-authority'
        ? asArray(society.market.pools)
        : marketStatus === 'regional-authority'
          ? asArray(society.market.regions).flatMap((region) => asArray(region.pools))
          : undefined;
    const pools = authorityPools ?? Object.values(world.marketPools || {});
    const moneySupply =
      authorityPools !== undefined ? society.market.moneySupply : world.moneySupply;
    const latestIndex = asArray(world.marketPriceIndices).at(-1);
    elements.marketMetrics.innerHTML = [
      metric(
        'Money supply',
        formatNumber(moneySupply, 2),
        authorityPools !== undefined
          ? marketStatus === 'regional-authority'
            ? 'town total · regional authority pools'
            : 'town total · unified authority pool'
          : 'partition currency',
      ),
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

  // -- Cognition -------------------------------------------------------------

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

  // -- Interventions ---------------------------------------------------------

  function renderSteering() {
    elements.steeringTraces.innerHTML = renderSteeringTraces(state.steeringTraces);
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

  // -- Access & selectors ------------------------------------------------------

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

  // -- Global feedback ---------------------------------------------------------

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

  return {
    renderAll,
    renderOverview,
    renderTown,
    renderMarket,
    renderCognition,
    renderSteering,
    renderAccess,
    syncAgentSelectors,
    renderPartitionOptions,
    renderPartialErrors,
  };
}

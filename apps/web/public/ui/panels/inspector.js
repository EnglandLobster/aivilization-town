/**
 * Right-side inspector drawer for the living-town canvas: building inspector,
 * agent summary (entry point into the cognition workspace) and the town
 * bulletin board. Rendering logic is migrated from the previous town-map
 * location inspector; data still comes exclusively from the projections.
 *
 * Also owns the flag-aware mechanism readouts that are not part of the canvas
 * layer pipeline: agent condition/conflict markers (`computeAgentMarkers`)
 * and the bulletin badge (`updateBulletinBadge`). Every one of them renders
 * nothing when the projection omits the corresponding optional field.
 */
import {
  asArray,
  currentAgentActivity,
  detailStat,
  empty,
  escapeAttribute,
  escapeHtml,
  formatNumber,
  formatSimulationTime,
  mapPercent,
  property,
  residentsAtLocation,
  townAgentLabel,
  travelersToLocation,
} from './workspaces.js';

/**
 * Builds the `{ agentId: [{ kind, label }] }` marker map drawn above agents.
 * Sources: society `agentConditions` (condition markers) and
 * `conflictRecords` (conflict markers, most recent per agent). Both fields
 * are flag-gated; missing fields simply produce no markers.
 */
export function computeAgentMarkers(state) {
  const markers = {};
  const push = (agentId, marker) => {
    if (!agentId) return;
    (markers[agentId] ||= []).push(marker);
  };
  for (const entry of asArray(state.societyProjection?.agentConditions)) {
    for (const condition of asArray(entry?.conditions)) {
      push(entry.agentId, {
        kind: 'condition',
        label: String(condition.kind || 'condition'),
      });
    }
  }
  for (const record of asArray(state.societyProjection?.conflictRecords)) {
    const label = String(record?.kind || 'conflict');
    push(record?.actorAgentId, { kind: 'conflict', label });
    push(record?.targetAgentId, { kind: 'conflict', label });
  }
  return markers;
}

/**
 * Bulletin badge in the topbar. Hidden unless the projection carries the
 * flag-gated `bulletins` field (society or partition projection).
 */
export function updateBulletinBadge(elements, state) {
  const badge = elements.bulletinBadge;
  const bulletins = readBulletins(state);
  if (bulletins === undefined) {
    badge.hidden = true;
    return 0;
  }
  badge.hidden = false;
  const effective = bulletins.filter((bulletin) => bulletin?.status === 'effective');
  const label = effective.length || bulletins.length;
  badge.querySelector('[data-bulletin-count]').textContent = String(label);
  badge.setAttribute('aria-label', `Town bulletins: ${label} posted. Activate to read.`);
  badge.title = `${label} bulletin(s) on the town board`;
  return label;
}

/** Returns the bulletins array, or undefined when the field is flag-gated off. */
function readBulletins(state) {
  return state.societyProjection?.bulletins ?? state.projectionEnvelope?.projection?.bulletins;
}

/**
 * @param ctx {{
 *   state: object,
 *   elements: Record<string, HTMLElement>,
 *   projection: () => object|undefined,
 *   townProjection: () => object|undefined,
 * }}
 */
export function createInspector(ctx) {
  const { state, elements, projection, townProjection } = ctx;
  let mode = null; // 'location' | 'agent' | 'bulletins' | null

  function open() {
    elements.inspector.hidden = false;
  }

  function close() {
    mode = null;
    elements.inspector.hidden = true;
  }

  function showLocation(locationId) {
    state.selectedLocationId = locationId;
    mode = 'location';
    open();
    render();
  }

  function showAgent(agentId) {
    state.selectedAgentId = agentId;
    mode = 'agent';
    open();
    render();
  }

  function showBulletins() {
    mode = 'bulletins';
    open();
    render();
  }

  /** Re-renders the current target after a data refresh. */
  function render() {
    if (mode === 'location') renderLocation();
    else if (mode === 'agent') renderAgent();
    else if (mode === 'bulletins') renderBulletins();
  }

  function showPane(pane) {
    elements.townLocationInspector.hidden = pane !== 'location';
    elements.agentInspector.hidden = pane !== 'agent';
    elements.inspectorBulletins.hidden = pane !== 'bulletins';
  }

  function renderLocation() {
    showPane('location');
    const world = townProjection() || {};
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

  function renderAgent() {
    showPane('agent');
    const agentId = state.selectedAgentId;
    const world = townProjection() || {};
    const detailWorld = projection() || {};
    const agent = detailWorld.agents?.[agentId] || world.agents?.[agentId];
    if (!agent) {
      elements.agentInspector.innerHTML = empty('Select an agent on the map to inspect it.');
      return;
    }
    const conditions = asArray(state.societyProjection?.agentConditions).find(
      (entry) => entry?.agentId === agentId,
    );
    const conditionTags = asArray(conditions?.conditions)
      .map(
        (condition) =>
          `<span class="tag">${escapeHtml(condition.kind)} · ${escapeHtml(condition.severity || '')}</span>`,
      )
      .join('');
    elements.agentInspector.innerHTML = `
      <div class="town-inspector-head">
        <span class="eyebrow">Selected agent</span>
        <h2>${escapeHtml(townAgentLabel(agent))}</h2>
        <p class="mono">${escapeHtml(agent.agentId)}</p>
      </div>
      <div class="detail-grid">
        ${detailStat('Energy', formatNumber(agent.physiology?.energy, 1))}
        ${detailStat('Health', formatNumber(agent.physiology?.health, 1))}
      </div>
      <dl class="property-list">
        ${property('Location', agent.locationId || '—')}
        ${property('Occupation', agent.job || 'Unemployed')}
        ${property('Activity', currentAgentActivity(world, agent))}
      </dl>
      ${conditionTags ? `<div class="town-inspector-section"><span class="town-inspector-label">Active conditions</span><div class="tag-row">${conditionTags}</div></div>` : ''}
      <button class="town-directory-link" type="button" data-open-cognition="${escapeAttribute(agent.agentId)}">
        Open cognition workspace
      </button>`;
  }

  function renderBulletins() {
    showPane('bulletins');
    const bulletins = readBulletins(state);
    const rows = asArray(bulletins)
      .map(
        (bulletin) =>
          `<div class="record"><div class="record-head"><strong>${escapeHtml(bulletin.title || bulletin.bulletinId || 'Bulletin')}</strong><span class="tag">${escapeHtml(bulletin.status || 'posted')}</span></div><p>${escapeHtml(bulletin.body || bulletin.summary || '')}</p><div class="record-meta"><span>effective t=${formatNumber(bulletin.effectiveAt, 0)}</span><span>${escapeHtml(formatSimulationTime(bulletin.effectiveAt))}</span></div></div>`,
      )
      .join('');
    elements.inspectorBulletins.innerHTML = `
      <div class="town-inspector-head">
        <span class="eyebrow">Town board</span>
        <h2>Bulletins</h2>
      </div>
      <div class="record-list">${rows || empty('No bulletins posted.')}</div>`;
  }

  return {
    open,
    close,
    render,
    showLocation,
    showAgent,
    showBulletins,
    currentMode() {
      return mode;
    },
  };
}

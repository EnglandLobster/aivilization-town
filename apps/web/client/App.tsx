import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { TownClient } from './store';
import { viewFromHash } from './store';
import type { View } from './model';
import { activity, format, text, words, rows } from './model';
import { Icon } from './components/Icon';
import type { IconName } from './components/Icon';
import { Inspector } from './components/Inspector';
import { MapView } from './components/MapView';
import { Panels } from './components/Panels';
import type { MapHandle } from './map/renderer';
import { describePulseRecord } from './map/logic/ambient.js';
const views: { id: View; name: string; icon: IconName }[] = [
  { id: 'map', name: 'Explore', icon: 'town' },
  { id: 'town', name: 'Citizens', icon: 'people' },
  { id: 'market', name: 'Economy', icon: 'chart' },
  { id: 'cognition', name: 'Minds', icon: 'mind' },
  { id: 'steering', name: 'Participate', icon: 'leaf' },
];
export function App({ client }: { client: TownClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot),
    map = useRef<MapHandle | null>(null);
  const places = Object.values(state.town.locations),
    citizens = Object.values(state.town.agents),
    traveling = Object.keys(state.town.transitByAgent).length;
  const occupancy = new Map<string, number>();
  citizens.forEach((citizen) => {
    if (!state.town.transitByAgent[citizen.agentId])
      occupancy.set(citizen.locationId, (occupancy.get(citizen.locationId) ?? 0) + 1);
  });
  useEffect(() => {
    client.start();
    const hash = () => client.setView(viewFromHash());
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        client.select(null);
        client.setView('map');
      }
    };
    window.addEventListener('hashchange', hash);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('keydown', escape);
      client.destroy();
    };
  }, [client]);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.title = `${views.find((view) => view.id === state.view)?.name ?? 'Mission control'} · Aivilization`;
  }, [state.theme, state.view]);
  const pulse = [...state.town.townPulse]
    .sort((a, b) => Number(b.sequence) - Number(a.sequence))
    .slice(0, 3);
  const life = citizens.filter((citizen) => state.town.transitByAgent[citizen.agentId]).slice(0, 3);
  const bulletinCount = rows(state.society.bulletins ?? state.projection.bulletins).length;
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => client.setView('map')}
          aria-label="Aivilization home"
        >
          <span className="brand-mark">
            <Icon name="town" size={24} />
          </span>
          <span>
            Aivilization<small>A LIVING WORLD OF AI</small>
          </span>
        </button>
        <nav aria-label="Observatory workspaces">
          {views.map((view) => (
            <button
              key={view.id}
              aria-current={state.view === view.id ? 'page' : undefined}
              className={state.view === view.id ? 'active' : ''}
              onClick={() => client.setView(view.id)}
            >
              <Icon name={view.icon} size={17} />
              <span>{view.name}</span>
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className={`connection ${state.connected ? 'connected' : ''}`} role="status">
            <i />
            {state.connected ? 'Connected' : state.observedAt ? 'Reconnecting' : 'Connecting'}
          </span>
          <button
            className="icon-button"
            aria-label={`Switch to ${state.theme === 'light' ? 'dark' : 'light'} theme`}
            onClick={() => client.setTheme(state.theme === 'light' ? 'dark' : 'light')}
          >
            <Icon name={state.theme === 'light' ? 'moon' : 'sun'} />
          </button>
          <button
            className="icon-button"
            aria-label="Mission control"
            onClick={() => client.setView('overview')}
          >
            <Icon name="sliders" />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="city-sidebar">
          <div className="city-title">
            <span className="eyebrow">YOUR WINDOW INTO</span>
            <h2>
              The living town<span>.</span>
            </h2>
            <p>
              Ordinary moments.
              <br />
              Extraordinary possibilities.
            </p>
          </div>
          <div className="city-summary">
            <div>
              <Icon name="people" />
              <span>Citizens</span>
              <strong>{state.observedAt ? format(state.town.population) : '—'}</strong>
            </div>
            <div>
              <Icon name="walk" />
              <span>On the move</span>
              <strong>{state.observedAt ? format(traveling) : '—'}</strong>
            </div>
            <div>
              <Icon name="pin" />
              <span>Places</span>
              <strong>{state.observedAt ? places.length : '—'}</strong>
            </div>
          </div>
          <div className="sidebar-section-heading">
            <h3>AROUND THE TOWN</h3>
            <span>{places.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="place-list">
            {places.map((place, index) => (
              <button
                key={place.locationId}
                className={state.selection?.id === place.locationId ? 'selected' : ''}
                onClick={() => {
                  client.select({ type: 'location', id: place.locationId });
                  client.setView('map');
                  map.current?.focus({ type: 'location', id: place.locationId });
                }}
              >
                <span className={`place-icon place-color-${index % 5}`}>
                  <Icon
                    name={
                      place.kind === 'residence'
                        ? 'people'
                        : place.locationId.includes('market')
                          ? 'chart'
                          : place.locationId.includes('school')
                            ? 'mind'
                            : 'town'
                    }
                    size={18}
                  />
                </span>
                <span>
                  <strong>{place.name}</strong>
                  <small>
                    {occupancy.get(place.locationId) ?? 0} here · {words(place.kind)}
                  </small>
                </span>
                <Icon name="arrow" size={13} />
              </button>
            ))}
          </div>
          <div className="sidebar-foot">
            <span className="eyebrow">
              OBSERVATION {String(state.town.sequence).padStart(5, '0')}
            </span>
            <div>
              <span>
                {state.observedAt
                  ? new Date(state.observedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Waiting for the town'}
              </span>
              <button
                className="icon-button"
                aria-label="Refresh town"
                disabled={state.loading}
                onClick={() => {
                  void client.refresh();
                }}
              >
                <Icon name="refresh" size={15} />
              </button>
            </div>
            <small>{text(state.partition.partitionKey, 'Discovering partition')}</small>
          </div>
        </aside>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <MapView state={state} client={client} mapRef={map} />
          <Panels state={state} client={client} />
          <Inspector state={state} client={client} map={map.current} />
          {state.errors.length > 0 && (
            <details className="connection-alert">
              <summary>
                {state.observedAt
                  ? 'Some observations are unavailable'
                  : 'The town could not be loaded'}{' '}
                · Details
              </summary>
              <p>{state.errors.join('\n')}</p>
              <button
                onClick={() => {
                  void client.refresh();
                }}
              >
                Try again
              </button>
            </details>
          )}
        </main>
      </div>
      <footer className="town-journal">
        <div className="journal-heading">
          <Icon name="leaf" />
          <div>
            <strong>Life, as it happens</strong>
            <span>
              {bulletinCount
                ? `${bulletinCount} town bulletins`
                : 'Moments from the current observation'}
            </span>
          </div>
        </div>
        <div className="journal-items">
          {pulse.length ? (
            pulse.map((item, index) => (
              <div className="journal-item" key={index}>
                <span className="journal-dot" />
                <div>
                  <span>{words(item.kind)}</span>
                  <strong>{describePulseRecord(item).text}</strong>
                </div>
              </div>
            ))
          ) : life.length ? (
            life.map((citizen) => (
              <button
                className="journal-item"
                key={citizen.agentId}
                onClick={() => {
                  client.select({ type: 'agent', id: citizen.agentId });
                  client.setView('map');
                  map.current?.focus({ type: 'agent', id: citizen.agentId });
                }}
              >
                <span className="journal-dot" />
                <div>
                  <span>{citizen.name}</span>
                  <strong>{activity(state.town, citizen)}</strong>
                </div>
                <Icon name="arrow" size={14} />
              </button>
            ))
          ) : (
            <div className="journal-item">
              <span className="journal-dot" />
              <div>
                <span>THE TOWN TODAY</span>
                <strong>
                  {state.observedAt
                    ? `${format(state.town.population)} individual stories. Choose a citizen to begin.`
                    : 'Waiting for the first observation…'}
                </strong>
              </div>
            </div>
          )}
        </div>
        <button
          className="journal-more"
          aria-label="Open town evidence"
          onClick={() => client.setView('overview')}
        >
          <Icon name="arrow" />
        </button>
      </footer>
    </div>
  );
}

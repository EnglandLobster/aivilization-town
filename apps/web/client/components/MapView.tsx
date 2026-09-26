import { useEffect, useRef, useState } from 'react';
import type { TownClient, Snapshot } from '../store';
import type { MapHandle } from '../map/renderer';
import { createMap } from '../map/renderer';
import { Icon } from './Icon';
import { numeric, text, words } from '../model';
export function MapView({
  state,
  client,
  mapRef,
}: {
  state: Snapshot;
  client: TownClient;
  mapRef: React.RefObject<MapHandle | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(state),
    clockAnchor = useRef({ clock: Number.NaN, receivedAt: 0 });
  const [error, setError] = useState(''),
    [layer, setLayer] = useState('life'),
    [ready, setReady] = useState(false);
  latest.current = state;
  if (state.observedAt && state.town.clock !== clockAnchor.current.clock)
    clockAnchor.current = { clock: state.town.clock, receivedAt: state.observedAt };
  useEffect(() => {
    let disposed = false;
    if (!canvas.current) return;
    void createMap(
      canvas.current,
      (selection) => client.select(selection),
      () => {
        const snapshot = latest.current;
        const elapsed =
          snapshot.daemon.status === 'paused'
            ? 0
            : Math.min(5000, Math.max(0, Date.now() - clockAnchor.current.receivedAt));
        return snapshot.town.clock + elapsed;
      },
    )
      .then((renderer) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        mapRef.current = renderer;
        renderer.setWorld(latest.current.town);
        renderer.select(latest.current.selection);
        renderer.setActive(latest.current.view === 'map');
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Map unavailable');
      });
    return () => {
      disposed = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [client, mapRef]);
  useEffect(() => {
    mapRef.current?.setWorld(state.town);
  }, [state.town, mapRef]);
  useEffect(() => {
    mapRef.current?.select(state.selection);
  }, [state.selection, mapRef]);
  useEffect(() => {
    mapRef.current?.setActive(state.view === 'map');
  }, [state.view, mapRef]);
  const calendar = state.town.calendar,
    weather = state.town.weather;
  return (
    <section
      className="map-view"
      aria-label="Living town map"
      inert={state.view !== 'map'}
      aria-hidden={state.view !== 'map'}
    >
      <div className="map-heading">
        <span className="eyebrow">
          <i className="live-dot" /> THE LIVING TOWN
        </span>
        <h1>A world unfolding.</h1>
        <p>
          {state.town.population > 1200
            ? 'Crowds are grouped. Find any individual in Citizens.'
            : 'Every citizen has a life. Follow one.'}
        </p>
      </div>
      <canvas
        id="town-canvas"
        ref={canvas}
        aria-label="Pixel town map. Explore buildings and citizens using the directory and place buttons."
      />
      {error && (
        <div className="map-error" role="alert">
          <Icon name="town" size={32} />
          <h2>The map could not start</h2>
          <p>{error}</p>
          <button onClick={() => client.setView('town')}>
            Explore the citizen directory <Icon name="arrow" />
          </button>
        </div>
      )}
      <div className="map-layer-control" aria-label="Map layers">
        {[
          ['life', 'Life'],
          ['population', 'Population'],
          ['routes', 'Routes'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={layer === id ? 'active' : ''}
            aria-pressed={layer === id}
            onClick={() => {
              setLayer(id!);
              mapRef.current?.setLayer(id!);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <select
        className="map-place-picker"
        aria-label="Explore a place"
        value={state.selection?.type === 'location' ? state.selection.id : ''}
        onChange={(event) => {
          if (!event.target.value) return;
          const selection = { type: 'location' as const, id: event.target.value };
          client.select(selection);
          mapRef.current?.focus(selection);
        }}
      >
        <option value="">Explore a place…</option>
        {Object.values(state.town.locations).map((place) => (
          <option key={place.locationId} value={place.locationId}>
            {place.name}
          </option>
        ))}
      </select>
      <div className="map-legend">
        <span className="legend-people" /> Citizens <span className="legend-roads" /> Connections
        <span className="legend-trees" /> Green spaces
      </div>
      <div className="map-time">
        <Icon
          name={
            calendar.phase === 'night' || calendar.phase === 'evening'
              ? 'moon'
              : weather.current && weather.current !== 'sunny'
                ? 'cloud'
                : 'sun'
          }
          size={21}
        />
        <div>
          <strong>
            {calendar.phase
              ? `Day ${numeric(calendar.dayIndex) + 1} · ${words(calendar.phase)}`
              : 'Town time'}
          </strong>
          <span>
            {weather.current ? words(weather.current) : 'Current observation'} ·{' '}
            {Math.floor(state.town.clock / 3600000) % 24}:
            {String(Math.floor(state.town.clock / 60000) % 60).padStart(2, '0')}
          </span>
        </div>
        <span className="time-rule" />
        <span className="time-note">
          semantic layout
          <br />
          interpolated movement
        </span>
      </div>
      <div className="map-navigation">
        <div className="compass">
          <span>N</span>
          <svg width="27" height="27" viewBox="0 0 30 30" aria-hidden="true">
            <path d="m15 2 6 23-6-5-6 5z" fill="currentColor" />
          </svg>
        </div>
        <div className="zoom-controls">
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoom(1.3)}>
            <Icon name="plus" />
          </button>
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoom(1 / 1.3)}>
            <Icon name="minus" />
          </button>
          <button aria-label="Fit town to view" onClick={() => mapRef.current?.reset()}>
            <Icon name="focus" />
          </button>
        </div>
      </div>
      {(!state.observedAt || !ready) && !error && (
        <div className="map-loading" role="status">
          <span className="loading-orbit" />
          <span>Opening the town…</span>
        </div>
      )}
      <span className="map-coordinate">
        {text(state.partition.partitionKey, 'Discovering town')}
        <a href="https://kenney.nl/assets/roguelike-modern-city" target="_blank" rel="noreferrer">
          PIXEL ART · KENNEY · CC0
        </a>
        <span>DRAG TO EXPLORE · SCROLL TO ZOOM</span>
      </span>
    </section>
  );
}

import type { Snapshot, TownClient } from '../store';
import type { MapHandle } from '../map/renderer';
import { activity, record, rows, format, words, text } from '../model';
import { Avatar, Icon } from './Icon';
export function Inspector({
  state,
  client,
  map,
}: {
  state: Snapshot;
  client: TownClient;
  map: MapHandle | null;
}) {
  const selected = state.selection;
  if (!selected) return null;
  const citizen = selected.type === 'agent' ? state.town.agents[selected.id] : undefined;
  const place = selected.type === 'location' ? state.town.locations[selected.id] : undefined;
  const residents = place
    ? Object.values(state.town.agents).filter(
        (item) => item.locationId === place.locationId && !state.town.transitByAgent[item.agentId],
      )
    : [];
  const incoming = place
    ? Object.values(state.town.transitByAgent).filter(
        (item) => record(item).toLocationId === place.locationId,
      ).length
    : 0;
  const conditions = rows(state.society.agentConditions).find(
    (item) => item.agentId === citizen?.agentId,
  );
  return (
    <aside className="inspector" aria-label="Selection details">
      <button
        className="icon-button inspector-close"
        aria-label="Close selection"
        onClick={() => client.select(null)}
      >
        <Icon name="close" />
      </button>
      <span className="eyebrow">{citizen ? 'ONE LIFE IN THE TOWN' : 'A PLACE IN THE TOWN'}</span>
      {citizen ? (
        <>
          <div className="inspector-identity">
            <Avatar name={citizen.agentId} />
            <div>
              <h2>{citizen.name}</h2>
              <span>{words(citizen.job)}</span>
            </div>
          </div>
          <div className="current-activity">
            <span className="live-dot" />
            {activity(state.town, citizen)}
          </div>
          <div className="detail-stats">
            <div>
              <span>Balance</span>
              <strong>
                {format(citizen.detail.balance, 1)} <small>¤</small>
              </strong>
            </div>
            <div>
              <span>Education</span>
              <strong>{format(citizen.detail.educationScore)}</strong>
            </div>
          </div>
          <dl className="properties">
            {['energy', 'health', 'satiety'].map((key) => (
              <div key={key}>
                <dt>{words(key)}</dt>
                <dd>{format(record(citizen.detail.physiology)[key], 1)}</dd>
              </div>
            ))}
            <div>
              <dt>Home</dt>
              <dd>{state.town.locations[text(citizen.detail.residenceLocationId)]?.name ?? '—'}</dd>
            </div>
          </dl>
          {rows(conditions?.conditions).length > 0 && (
            <div className="tag-list">
              {rows(conditions?.conditions).map((item, index) => (
                <span className="tag" key={index}>
                  {words(item.kind)} {text(item.severity, '')}
                </span>
              ))}
            </div>
          )}
          <p className="subtle small">
            {citizen.ownerPartitionKey !== state.partition.partitionKey
              ? 'Loading the citizen’s home partition…'
              : 'Observed from the current simulation snapshot.'}
          </p>
          <button className="primary full" onClick={() => client.setView('cognition')}>
            Explore their mind <Icon name="mind" />
          </button>
          <button
            className="secondary full"
            onClick={() => {
              client.setView('map');
              map?.focus(selected);
            }}
          >
            Find on the map <Icon name="focus" />
          </button>
        </>
      ) : place ? (
        <>
          <div className="place-symbol">
            <Icon name="town" size={32} />
          </div>
          <h2>{place.name}</h2>
          <p className="subtle">
            {words(place.kind)} · {words(place.regionId)}
          </p>
          <div className="detail-stats">
            <div>
              <span>Here now</span>
              <strong>{residents.length}</strong>
            </div>
            <div>
              <span>On their way</span>
              <strong>{incoming}</strong>
            </div>
            <div>
              <span>Capacity</span>
              <strong>{place.capacity === null ? 'Open' : format(place.capacity)}</strong>
            </div>
          </div>
          <h3>
            People here <span>{residents.length}</span>
          </h3>
          <div className="resident-list">
            {residents.slice(0, 30).map((item) => (
              <button
                className="person-row"
                key={item.agentId}
                onClick={() => client.select({ type: 'agent', id: item.agentId })}
              >
                <Avatar small name={item.agentId} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{activity(state.town, item)}</small>
                </span>
                <Icon name="arrow" size={14} />
              </button>
            ))}
            {residents.length === 0 && <p className="empty">Nobody is here at this observation.</p>}
            {residents.length > 30 && (
              <button className="text-button" onClick={() => client.setView('town')}>
                Explore all {residents.length} residents
              </button>
            )}
          </div>
          <div className="tag-list">
            {place.activityAffinities.map((item, index) => (
              <span className="tag" key={index}>
                {words(item)}
              </span>
            ))}
          </div>
          <button
            className="secondary full"
            onClick={() => {
              client.setView('map');
              map?.focus(selected);
            }}
          >
            Move closer <Icon name="focus" />
          </button>
        </>
      ) : (
        <p className="empty">This selection is no longer in the current snapshot.</p>
      )}
    </aside>
  );
}

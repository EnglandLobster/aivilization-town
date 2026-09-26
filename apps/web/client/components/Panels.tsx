import { useMemo, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { Snapshot, TownClient } from '../store';
import { activity, citizenList, entries, format, record, rows, text, words } from '../model';
import type { Row } from '../model';
import { Avatar, Icon } from './Icon';
const titles = {
  town: ['THE PEOPLE', 'A town of individual lives.', 'Find a citizen. Discover what moves them.'],
  market: [
    'THE ECONOMY',
    'The exchange of everyday life.',
    'Markets, reserves and the trades that connect the town.',
  ],
  cognition: [
    'INSIDE A MIND',
    'Intentions become actions.',
    'Follow the evidence behind a citizen’s decisions.',
  ],
  overview: [
    'MISSION CONTROL',
    'A window into the simulation.',
    'Runtime health, partitions and scientific evidence.',
  ],
  steering: [
    'HUMAN PARTICIPATION',
    'Leave your mark on the town.',
    'Submit an intention and follow its durable outcome.',
  ],
  map: ['', '', ''],
};
export function Panels({ state, client }: { state: Snapshot; client: TownClient }) {
  if (state.view === 'map') return null;
  const [eyebrow, title, description] = titles[state.view];
  return (
    <section
      className={`panel-workspace ${state.selection ? 'has-inspector' : ''}`}
      aria-label={title}
    >
      <header className="panel-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Return to city"
          onClick={() => client.setView('map')}
        >
          <Icon name="close" />
        </button>
      </header>
      {state.view === 'town' ? (
        <Population state={state} client={client} />
      ) : state.view === 'market' ? (
        <Economy state={state} />
      ) : state.view === 'cognition' ? (
        <Cognition state={state} client={client} />
      ) : state.view === 'overview' ? (
        <Overview state={state} client={client} />
      ) : (
        <Interventions state={state} client={client} />
      )}
    </section>
  );
}
function Population({ state, client }: { state: Snapshot; client: TownClient }) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [place, setPlace] = useState('');
  const citizens = useMemo(
    () =>
      citizenList(state.town).filter(
        (item) =>
          (!place || item.locationId === place) &&
          [item.name, item.agentId, item.job].some((value) =>
            value.toLowerCase().includes(search.toLowerCase()),
          ),
      ),
    [state.town, search, place],
  );
  const pages = Math.max(1, Math.ceil(citizens.length / 50)),
    current = Math.min(page, pages - 1);
  return (
    <>
      <div className="directory-toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search citizens"
            placeholder="Find a name, occupation or ID…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          aria-label="Filter citizens by place"
          value={place}
          onChange={(event) => {
            setPlace(event.target.value);
            setPage(0);
          }}
        >
          <option value="">All places</option>
          {Object.values(state.town.locations).map((item) => (
            <option key={item.locationId} value={item.locationId}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="subtle">{format(citizens.length)} citizens</span>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Citizen</th>
              <th>Life right now</th>
              <th>Occupation</th>
              <th>Balance</th>
              <th>Education</th>
            </tr>
          </thead>
          <tbody>
            {citizens.slice(current * 50, current * 50 + 50).map((citizen) => (
              <tr
                key={citizen.agentId}
                className={state.selection?.id === citizen.agentId ? 'selected' : ''}
              >
                <td>
                  <button
                    className="person-row"
                    onClick={() => client.select({ type: 'agent', id: citizen.agentId })}
                  >
                    <Avatar small name={citizen.agentId} />
                    <span>
                      <strong>{citizen.name}</strong>
                      <small>{citizen.agentId}</small>
                    </span>
                  </button>
                </td>
                <td>{activity(state.town, citizen)}</td>
                <td>{words(citizen.job)}</td>
                <td className="numeric">{format(citizen.detail.balance, 1)}</td>
                <td className="numeric">{format(citizen.detail.educationScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {citizens.length === 0 && <p className="empty">No citizens match these filters.</p>}
      </div>
      <div className="pagination">
        <span>
          Page {current + 1} of {pages}
        </span>
        <div>
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </div>
      </div>
    </>
  );
}
function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
function Economy({ state }: { state: Snapshot }) {
  const market = record(state.society.market),
    regional = market.status === 'regional-authority',
    authoritative = regional || market.status === 'unified-authority';
  const pools = regional
    ? rows(market.regions).flatMap((region) =>
        rows(region.pools).map((pool) => ({ ...pool, regionId: region.regionId })),
      )
    : authoritative
      ? rows(market.pools)
      : entries(state.projection.marketPools);
  const trades = rows(state.resources.trades);
  return (
    <>
      <div className="metrics">
        <Stat
          label="Money supply"
          value={format(authoritative ? market.moneySupply : state.projection.moneySupply, 1)}
          note={authoritative ? 'Town authority' : 'Selected partition'}
        />
        <Stat label="Market pools" value={pools.length} />
        <Stat label="Recent trades" value={trades.length} note="Loaded observation window" />
      </div>
      <article className="surface">
        <div className="section-heading">
          <h2>Market reserves</h2>
          <span className="tag">{words(market.status ?? 'partition markets')}</span>
        </div>
        <DataTable
          data={pools}
          columns={
            regional
              ? ['regionId', 'commodity', 'commodityReserve', 'currencyReserve']
              : ['commodity', 'commodityReserve', 'currencyReserve']
          }
        />
      </article>
      <article className="surface">
        <h2>Recent exchanges</h2>
        <DataTable
          data={trades}
          columns={['commodityId', 'side', 'price', 'commodityQuantity', 'currencyQuantity']}
        />
        <ResourceError value={state.resources.trades} />
      </article>
      <Records
        title="Price observations"
        data={rows(state.projection.marketPriceIndices).slice(-8).reverse()}
        label="recordedAt"
      />
      <ResourceError value={state.resources.bars} />
      <Records title="OHLC observations" data={rows(state.resources.bars)} label="commodityId" />
    </>
  );
}
function Cognition({ state, client }: { state: Snapshot; client: TownClient }) {
  const citizen =
    state.selection?.type === 'agent' ? state.town.agents[state.selection.id] : undefined;
  if (!citizen)
    return (
      <div className="empty-feature">
        <Icon name="mind" size={48} />
        <h2>Every action begins with an intention.</h2>
        <p>Choose a citizen to explore their plans, memories and decision traces.</p>
        <button className="primary" onClick={() => client.setView('town')}>
          Meet the citizens <Icon name="arrow" />
        </button>
      </div>
    );
  return (
    <>
      <div className="cognition-identity">
        <Avatar name={citizen.agentId} />
        <div>
          <h2>{citizen.name}</h2>
          <p>{activity(state.town, citizen)}</p>
        </div>
        <button className="secondary" onClick={() => client.setView('town')}>
          Choose another citizen
        </button>
      </div>
      <article className="surface">
        <h2>Intentions & plans</h2>
        {rows(state.resources.plans).map((item, index) => {
          const plan = record(item.plan);
          return (
            <div className="plan" key={text(item.planId, String(index))}>
              <span className="eyebrow">{text(item.planId)}</span>
              <h3>{text(plan.objective, 'Untitled objective')}</h3>
              {rows(plan.branches).map((branch, branchIndex) => (
                <div className="branch" key={branchIndex}>
                  <h4>{text(branch.objective, text(branch.id))}</h4>
                  {rows(branch.subtasks).map((task, taskIndex) => (
                    <p key={taskIndex}>
                      <span className="step-number">{taskIndex + 1}</span>
                      {text(task.description, text(task.id))}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
        {!rows(state.resources.plans).length && (
          <p className="empty">No durable plans have been returned yet.</p>
        )}
        <ResourceError value={state.resources.plans} />
      </article>
      <article className="surface">
        <h2>Memory & identity</h2>
        <ResourceError value={state.resources.profile} />
        <div className="memory-grid">
          {['beliefs', 'habits', 'mood', 'values', 'personality', 'socialRecords'].map((key) => (
            <section key={key}>
              <h3>{words(key)}</h3>
              {rows(record(state.resources.profile)[key]).map((item, index) => (
                <p key={index}>{text(item.statement, text(item.key))}</p>
              ))}
              {!rows(record(state.resources.profile)[key]).length && (
                <p className="subtle small">No entries observed.</p>
              )}
            </section>
          ))}
        </div>
      </article>
      {['cycles', 'objectives', 'daily'].map((key) => (
        <ResourceError key={key} value={state.resources[key]} />
      ))}
      <Records
        title="Decision traces"
        data={rows(state.resources.cycles)}
        label="observedStateSummary"
      />
      <Records
        title="Objective renewals"
        data={rows(state.resources.objectives)}
        label="rationale"
      />
      <Records title="Daily plans" data={rows(state.resources.daily)} label="dailyPlanId" />
    </>
  );
}
function Overview({ state, client }: { state: Snapshot; client: TownClient }) {
  return (
    <>
      <div className="metrics">
        <Stat
          label="Runtime"
          value={words(state.daemon.health)}
          note={text(state.daemon.status, '')}
        />
        <Stat label="Partitions" value={state.partitions.length} />
        <Stat label="Observed sequence" value={format(state.town.sequence)} />
      </div>
      <div className="two-columns">
        <article className="surface">
          <h2>Runtime controls</h2>
          <p className="subtle">Changes apply to the authoritative simulation.</p>
          <ActionForm
            label="Run cycles"
            onSubmit={(data) =>
              client.mutate('/runtime/run', {
                requestedAt: Date.now(),
                cycleCount: Number(data.get('cycles')),
              })
            }
          >
            <label>
              Cycles
              <input name="cycles" type="number" min="1" max="1000" defaultValue="1" required />
            </label>
          </ActionForm>
          <div className="two-columns">
            {['pause', 'resume'].map((action) => (
              <ActionForm
                key={action}
                label={words(action)}
                onSubmit={() => client.mutate(`/runtime/${action}`, { requestedAt: Date.now() })}
              />
            ))}
          </div>
        </article>
        <article className="surface">
          <h2>Observation settings</h2>
          <label>
            Selected partition
            <select
              value={`${text(state.partition.simulationId)}/${text(state.partition.partitionKey)}`}
              onChange={(event) => client.setPartition(event.target.value)}
            >
              {state.partitions.map((item) => (
                <option
                  key={`${text(item.simulationId)}/${text(item.partitionKey)}`}
                  value={`${text(item.simulationId)}/${text(item.partitionKey)}`}
                >
                  {text(item.simulationId)} / {text(item.partitionKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Refresh cadence
            <select
              value={state.refreshInterval}
              onChange={(event) => client.setRefreshInterval(Number(event.target.value))}
            >
              <option value="0">Manual</option>
              <option value="2000">Every 2 seconds</option>
              <option value="5000">Every 5 seconds</option>
              <option value="15000">Every 15 seconds</option>
            </select>
          </label>
          <p className="small subtle">
            Live notifications also refresh the observation. Map motion is estimated between
            authoritative snapshots.
          </p>
        </article>
      </div>
      <Records
        title="Town bulletins"
        data={rows(state.society.bulletins ?? state.projection.bulletins)
          .slice(-50)
          .reverse()}
        label="summary"
      />
      <Records
        title="Production checks"
        data={rows(record(state.daemon.productionSlo).checks)}
        label="name"
      />
      <Records title="Partitions" data={state.partitions} label="partitionKey" />
      <ResourceError value={state.resources.reports} />
      <Records title="Validation evidence" data={rows(state.resources.reports)} label="runId" />
      <article className="surface">
        <h2>Replay durable events</h2>
        <ActionForm
          label="Replay range"
          onSubmit={(data) =>
            client.mutate('/replay', {
              requestedAt: client.simulationNow(),
              fromSequence: Number(data.get('from')),
              ...(data.get('to') ? { toSequence: Number(data.get('to')) } : {}),
            })
          }
        >
          <div className="two-columns">
            <label>
              From sequence
              <input name="from" type="number" min="0" defaultValue="0" required />
            </label>
            <label>
              To sequence (optional)
              <input name="to" type="number" min="0" />
            </label>
          </div>
          <p className="small subtle">Rebuilds the projection from the durable event stream.</p>
        </ActionForm>
      </article>
    </>
  );
}
function Interventions({ state, client }: { state: Snapshot; client: TownClient }) {
  const selected = state.selection?.type === 'agent' ? state.selection.id : '';
  const policy = record(state.access.policy),
    authentication = record(state.access.authentication);
  return (
    <>
      <article className="surface">
        <div className="section-heading">
          <h2>Access & ownership</h2>
          <span className="tag">{words(policy.mode)}</span>
        </div>
        <p className="subtle">
          {authentication.authenticated
            ? `Signed in as ${text(record(authentication.principal).subjectId)}`
            : 'Commands are checked by the server’s access policy.'}
        </p>
        <ActionForm
          label="Use access token"
          onSubmit={async (data) => {
            await client.authenticate(text(data.get('token'), ''), data.get('consent') === 'on');
            return {};
          }}
        >
          <label>
            Access token
            <input
              name="token"
              type="password"
              autoComplete="off"
              required
              placeholder="Provisioned Bearer token"
            />
          </label>
          <label className="check-label">
            <input name="consent" type="checkbox" required />I accept the participant data consent
            policy {text(policy.consentPolicyVersion, '')}.
          </label>
        </ActionForm>
        <ActionForm
          label="Clear token"
          onSubmit={async () => {
            await client.authenticate('', false);
            return {};
          }}
        />
      </article>
      <div className="two-columns">
        <article className="surface">
          <h2>A longer-term intention</h2>
          <p className="subtle">Give a citizen something to work toward.</p>
          <ActionForm
            label="Submit intention"
            onSubmit={(data) =>
              client.mutate(
                '/objectives',
                {
                  agentId: text(data.get('agent'), ''),
                  objectiveId: window.crypto.randomUUID(),
                  statement: text(data.get('statement'), ''),
                  priority: Number(data.get('priority')),
                  affinityTags: text(data.get('tags'), '')
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                  issuedAt: client.simulationNow(),
                },
                true,
              )
            }
          >
            <AgentField selected={selected} />
            <label>
              Intention
              <textarea
                name="statement"
                rows={3}
                required
                placeholder="What would you like this citizen to pursue?"
              />
            </label>
            <label>
              Priority
              <input name="priority" type="number" min="0" max="100" defaultValue="1" required />
            </label>
            <label>
              Affinity tags
              <input name="tags" placeholder="education, community" />
            </label>
          </ActionForm>
        </article>
        <article className="surface">
          <h2>A moment of guidance</h2>
          <p className="subtle">Suggest an immediate action or adjustment.</p>
          <ActionForm
            label="Send guidance"
            onSubmit={(data) =>
              client.mutate(
                '/reactive-commands',
                {
                  agentId: text(data.get('agent'), ''),
                  reactiveCommandId: window.crypto.randomUUID(),
                  summary: text(data.get('summary'), ''),
                  tags: [],
                  issuedAt: client.simulationNow(),
                },
                true,
              )
            }
          >
            <AgentField selected={selected} />
            <label>
              Guidance
              <textarea
                name="summary"
                rows={4}
                required
                placeholder="Describe your immediate intention…"
              />
            </label>
          </ActionForm>
        </article>
      </div>
      <article className="surface">
        <h2>Welcome a new citizen</h2>
        <ActionForm
          label="Register citizen"
          onSubmit={(data) =>
            client.mutate(
              '/agents',
              {
                agentId: text(data.get('id'), ''),
                displayName: text(data.get('name'), ''),
                ...(policy.mode !== 'authenticated'
                  ? { creatorId: text(data.get('creator'), '') }
                  : {}),
                issuedAt: client.simulationNow(),
              },
              true,
            )
          }
        >
          <div className="two-columns">
            <label>
              Citizen ID
              <input name="id" required autoComplete="off" />
            </label>
            <label>
              Display name
              <input name="name" required />
            </label>
          </div>
          {policy.mode !== 'authenticated' && (
            <label>
              Creator attribution
              <input name="creator" required />
            </label>
          )}
          <p className="small subtle">
            An accepted registration becomes visible after the simulation processes it.
          </p>
        </ActionForm>
      </article>
      <ResourceError value={state.resources.steering} />
      <Records
        title="Intervention outcomes"
        data={rows(state.resources.steering)}
        label="summary"
      />
    </>
  );
}
function AgentField({ selected }: { selected: string }) {
  return (
    <label>
      Citizen ID
      <input
        name="agent"
        key={selected}
        defaultValue={selected}
        required
        placeholder="Choose a citizen from the directory or enter an ID"
      />
    </label>
  );
}
function ActionForm({
  label,
  onSubmit,
  children,
}: {
  label: string;
  onSubmit: (data: FormData) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false),
    [result, setResult] = useState(''),
    [failed, setFailed] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setResult('');
    setFailed(false);
    try {
      const response = record(await onSubmit(data));
      setResult(
        `Accepted${response.commandId || response.traceId || response.status ? ` · ${text(response.commandId ?? response.traceId ?? response.status)}` : ''}`,
      );
    } catch (error) {
      setFailed(true);
      setResult(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      className="action-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {children}
      <button className="primary" disabled={pending} type="submit">
        {pending ? 'Submitting…' : label}
        <Icon name="arrow" size={16} />
      </button>
      {result && (
        <output className={`action-result ${failed ? 'error' : ''}`} role="status">
          {result}
        </output>
      )}
    </form>
  );
}
function DataTable({ data, columns }: { data: Row[]; columns: string[] }) {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            {columns.map((key) => (
              <th key={key}>{words(key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => (
            <tr key={index}>
              {columns.map((key) => (
                <td key={key}>
                  {typeof item[key] === 'number' ? format(item[key], 3) : words(item[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <p className="empty">No observations are available yet.</p>}
    </div>
  );
}
function Records({ title, data, label }: { title: string; data: Row[]; label: string }) {
  return (
    <article className="surface">
      <div className="section-heading">
        <h2>{title}</h2>
        <span className="tag">{data.length} records</span>
      </div>
      {data.length ? (
        data.map((item, index) => (
          <details className="evidence-record" key={index}>
            <summary>
              <span>
                {text(item[label], text(item.traceId, text(item.id, `${title} ${index + 1}`)))}
              </span>
              <span className="subtle small">View evidence</span>
            </summary>
            <pre>{JSON.stringify(item, null, 2)}</pre>
          </details>
        ))
      ) : (
        <p className="empty">No {title.toLowerCase()} have been observed.</p>
      )}
    </article>
  );
}
function ResourceError({ value }: { value: unknown }) {
  const message = record(value).error;
  return message ? (
    <p className="error" role="status">
      {text(message)}
    </p>
  ) : null;
}

import { bindResidentPartitions, residentPartitionAuthorityId } from './partitionBindings';
import { nextResidentWakeDelta } from './residentWake';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { OpenSocietyRuntime, ResidentTurn } from '@aivilization/worker';
export const PARTITION_SCHEDULER_VERSION = 'resident-partition-scheduler-v1';
export type ResidentPartitionConfiguration = {
  readonly version: typeof PARTITION_SCHEDULER_VERSION;
  readonly leaseMs: number;
  readonly partitions: readonly {
    readonly id: string;
    readonly token: string;
    readonly actors: readonly string[];
  }[];
};
type Grant = {
  partitionId: string;
  claimId: string;
  actorId: string;
  turnId: string;
  token: string;
  expiresAt: number;
};
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Infrastructure authentication and scheduling only. Domain effects remain exclusively in Runtime. */
export class ResidentPartitionExecution {
  private readonly authorityId: string;
  private readonly grants = new Map<string, Grant>();
  private readonly receipts = new Map<string, { signature: string; turn: ResidentTurn }>();
  readonly configuration: ResidentPartitionConfiguration;
  constructor(
    readonly runtime: OpenSocietyRuntime,
    configuration: ResidentPartitionConfiguration,
    private readonly now: () => number = Date.now,
  ) {
    this.configuration = structuredClone(configuration);
    configuration = this.configuration;
    const partitions: ResidentPartitionConfiguration['partitions'] = configuration.partitions;
    if (
      configuration.version !== PARTITION_SCHEDULER_VERSION ||
      !Number.isSafeInteger(configuration.leaseMs) ||
      configuration.leaseMs < 1000 ||
      configuration.leaseMs > 600000 ||
      !Array.isArray(configuration.partitions) ||
      !configuration.partitions.length
    )
      throw Error('invalid-partition-configuration');
    const ids = new Set<string>(),
      tokens = new Set<string>(),
      actors = new Set<string>();
    for (const p of partitions) {
      const actorIds: readonly string[] = p.actors;
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) ||
        ids.has(p.id) ||
        typeof p.token !== 'string' ||
        p.token.length < 32 ||
        tokens.has(p.token) ||
        !Array.isArray(p.actors) ||
        !p.actors.length
      )
        throw Error('invalid-partition-configuration');
      ids.add(p.id);
      tokens.add(p.token);
      for (const a of actorIds) {
        if (typeof a !== 'string' || actors.has(a) || !Object.hasOwn(runtime.state.residents, a))
          throw Error('invalid-partition-ownership');
        actors.add(a);
      }
    }
    if (Object.keys(runtime.state.residents).some((a) => !actors.has(a)))
      throw Error('incomplete-partition-ownership');
    bindResidentPartitions(runtime.journal.rootDir, configuration);
    this.authorityId = residentPartitionAuthorityId(runtime.journal.rootDir);
  }
  partition(token: string): string | undefined {
    return this.configuration.partitions.find((p) => equal(token, p.token))?.id;
  }
  private pending(actor: string): ResidentTurn | undefined {
    const id = this.runtime.state.residents[actor]?.activeTurnId;
    const turn = id ? this.runtime.state.turns[id] : undefined;
    return turn && !this.runtime.journal.lookup(actor, `${turn.id}-finished`) ? turn : undefined;
  }
  private active(grant: Grant) {
    return grant.expiresAt > this.now() && this.pending(grant.actorId)?.id === grant.turnId;
  }
  actor(token: string): string | undefined {
    const grant = this.grants.get(token);
    return grant && this.active(grant) ? grant.actorId : undefined;
  }
  private expire() {
    for (const [token, g] of this.grants) if (!this.active(g)) this.grants.delete(token);
  }
  identity(partitionId: string) {
    if (!this.configuration.partitions.some((p) => p.id === partitionId))
      throw Error('unknown-partition');
    return { authorityId: this.authorityId, partitionId, version: PARTITION_SCHEDULER_VERSION };
  }
  claim(partitionId: string, claimId: string, expectedAuthorityId?: string) {
    if (expectedAuthorityId !== undefined && expectedAuthorityId !== this.authorityId)
      throw Error('partition-authority-mismatch');
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(claimId)) throw Error('invalid-partition-claim-id');
    const partition = this.configuration.partitions.find((p) => p.id === partitionId);
    if (!partition) throw Error('unknown-partition');
    this.expire();
    const existing = [...this.grants.values()].find((g) => g.partitionId === partitionId);
    if (existing)
      return existing.claimId === claimId
        ? this.delivery(existing)
        : { status: 'waiting' as const, simulationTime: this.runtime.state.world.clock.now };
    const owned = new Set(partition.actors);
    let actor =
      [...partition.actors].sort().find((a) => this.pending(a)) ?? this.runtime.nextResident(owned);
    if (!actor) {
      const pending = Object.keys(this.runtime.state.residents).some((a) => this.pending(a));
      if (!pending && !this.grants.size && !this.runtime.nextResident()) {
        const delta = nextResidentWakeDelta(this.runtime);
        if (delta !== undefined) {
          const result = this.runtime.advanceTime(
            delta,
            `partition-clock-${this.runtime.state.revision}`,
          );
          if (!result.ok) throw Error(result.error ?? 'partition-clock-refused');
        }
        actor = this.runtime.nextResident(owned);
      }
    }
    if (!actor)
      return { status: 'waiting' as const, simulationTime: this.runtime.state.world.clock.now };
    const turn = this.pending(actor) ?? this.runtime.beginTurn(actor);
    const grant = {
      partitionId,
      claimId,
      actorId: actor,
      turnId: turn.id,
      token: randomBytes(32).toString('hex'),
      expiresAt: this.now() + this.configuration.leaseMs,
    };
    this.grants.set(grant.token, grant);
    return this.delivery(grant);
  }
  private delivery(grant: Grant) {
    const prior = Object.values(this.runtime.state.turns)
      .filter((t) => t.actorId === grant.actorId && t.sessionId)
      .at(-1);
    return {
      status: 'claimed' as const,
      authorityId: this.authorityId,
      ...grant,
      remainingLeaseMs: Math.max(0, grant.expiresAt - this.now()),
      turn: this.runtime.state.turns[grant.turnId]!,
      context: this.runtime.context(grant.actorId),
      ...(prior?.sessionId ? { sessionId: prior.sessionId } : {}),
    };
  }
  finish(
    partitionId: string,
    token: string,
    input: { summary: string; status: 'completed' | 'provider-error'; sessionId?: string },
  ) {
    const receipt = this.receipts.get(`${partitionId}:${token}`);
    const signature = JSON.stringify([input.summary, input.status, input.sessionId ?? null]);
    if (receipt) {
      if (receipt.signature !== signature) throw Error('partition-finish-conflict');
      return receipt.turn;
    }
    const grant = this.grants.get(token);
    if (!grant || grant.partitionId !== partitionId || !this.active(grant))
      throw Error('invalid-or-expired-partition-grant');
    const turn = this.runtime.finishTurn(grant.actorId, input);
    this.grants.delete(token);
    this.receipts.set(`${partitionId}:${token}`, { signature, turn });
    // Receipt cache is only a bounded transport convenience; durable truth is turn.finished.
    if (this.receipts.size > 1024) this.receipts.delete(this.receipts.keys().next().value!);
    return turn;
  }
}

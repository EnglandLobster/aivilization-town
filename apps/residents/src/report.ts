import type { OpenSocietyRuntime } from '@aivilization/worker';

/** Administrator projection; never served through a resident credential. */
export function residentReport(runtime: OpenSocietyRuntime) {
  const state = runtime.state;
  return {
    schemaVersion: runtime.manifest.schemaVersion,
    simulationId: runtime.manifest.simulationId,
    simulationTime: state.world.clock.now,
    revision: state.revision,
    cityApps: state.cityApps ?? null,
    distribution: state.distribution ?? null,
    communication: state.communication ?? null,
    collaboration: state.collaboration ?? null,
    commerce: state.world.residentCommerce ?? null,
    services: state.services ?? null,
    life: state.life ?? null,
    leases: state.world.residentLeases ?? null,
    provenance: runtime.manifest.provenance,
    moneySupply: state.world.moneySupply,
    residents: runtime.manifest.residents.map((identity) => ({
      ...identity,
      world: state.world.agents[identity.id],
      runtime: state.residents[identity.id],
      activity: state.world.activityTimeByAgent[identity.id],
      transit: state.world.transitByAgent?.[identity.id],
      cognition: state.cognition[identity.id],
      experiences: state.experiences[identity.id],
    })),
    spaces: Object.values(state.information.spaces),
    documents: Object.values(state.information.documents),
    messages: Object.values(state.information.messages),
    turns: Object.values(state.turns),
    trace: runtime.journal.commits.map((commit) => ({
      sequence: commit.sequence,
      at: commit.at,
      actorId: commit.actorId,
      capability: commit.capability,
      ok: commit.result.ok,
      error: commit.result.error,
      worldEvents: commit.worldEvents?.map((event) => ({ id: event.id, type: event.type })),
      informationEvents: commit.informationEvents?.map((event) => event.type),
      distributionEvents: commit.distributionEvents?.map((event) => event.type),
      hash: commit.hash,
    })),
  };
}

/** Acceptance is evaluated from durable effects, never the model's narrative. */
export function verifyResidentChain(runtime: OpenSocietyRuntime) {
  const checks = runtime.manifest.residents.map(({ id }) => {
    const commits = runtime.journal.commits.filter(
      (commit) => commit.actorId === id && commit.result.ok,
    );
    const did = (capability: string) => commits.some((commit) => commit.capability === capability);
    const turns = Object.values(runtime.state.turns).filter((turn) => turn.actorId === id);
    const facts = {
      repeatedOpportunity:
        turns.filter((turn) => turn.status !== 'running' && turn.status !== 'provider-error')
          .length >= 2,
      observedWorld: did('world.observe'),
      retrievedMemory: did('memory.search') || did('memory.read'),
      updatedCognition: commits.some((commit) => (commit.cognitiveEvents?.length ?? 0) > 0),
      authoredDocument: Object.values(runtime.state.information.documents).some(
        (document) => document.authorId === id,
      ),
      sentMessage: Object.values(runtime.state.information.messages).some(
        (message) => message.senderId === id && message.recipientId !== id,
      ),
      readMessage: did('messages.read'),
      startedJourney: did('world.move'),
      waited: did('schedule.wait'),
      arrived: runtime.journal.commits.some((commit) =>
        commit.worldEvents?.some(
          (event) => event.type === 'AgentLocationChanged' && event.payload.agentId === id,
        ),
      ),
    };
    return {
      actorId: id,
      checks: facts,
      missing: Object.entries(facts)
        .filter(([, passed]) => !passed)
        .map(([name]) => name),
    };
  });
  return {
    mode: 'prompted-integration-verification',
    passed: checks.length >= 2 && checks.every((check) => check.missing.length === 0),
    residents: checks,
  };
}

import { pendingProgramReactions } from '@aivilization/collaboration';
import { type OpenSocietyJournal, digest } from './journal';
import { appendProgramReactions, executeQueuedProgramReaction } from './reactionExecution';
/** Serial application coordinator. The journal remains an I/O and replay adapter. */
export class ProgramReactionRuntime {
  private draining = false;
  private active = false;
  constructor(private readonly journal: OpenSocietyJournal) {}
  activate() {
    this.active = true;
  }
  commit(input: Parameters<OpenSocietyJournal['commit']>[0]) {
    const cached = this.journal.lookup(input.actorId, input.requestId);
    const result = this.journal.commit(
      cached
        ? input
        : { ...input, effects: appendProgramReactions(this.journal.state, input.effects) },
    );
    this.resume();
    return result;
  }
  resume(): { processed: number; pending: number } {
    const state = this.journal.state.coordination?.reactions;
    if (!state || !this.active || this.draining)
      return { processed: 0, pending: state ? pendingProgramReactions(state).length : 0 };
    this.draining = true;
    let processed = 0;
    try {
      while (processed < state.policy.maxPerDrain) {
        const current = this.journal.state;
        const reaction = pendingProgramReactions(current.coordination!.reactions!)[0];
        if (!reaction) break;
        const effects = executeQueuedProgramReaction(current, this.journal.manifest, reaction.id);
        this.commit({
          actorId: 'system',
          requestId: `reaction-${digest([reaction.id]).slice(0, 32)}`,
          fingerprint: digest({ reactionId: reaction.id, sourceSequence: reaction.sourceSequence }),
          capability: 'system.program-reaction',
          effects,
          result: {
            ok: true,
            data: { reactionId: reaction.id },
            revision: current.revision + 1,
            simulationTime: current.world.clock.now,
          },
        });
        processed++;
      }
    } finally {
      this.draining = false;
    }
    return {
      processed,
      pending: pendingProgramReactions(this.journal.state.coordination.reactions).length,
    };
  }
}

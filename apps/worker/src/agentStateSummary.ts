export type ObservedAgentStateSummaryInput = {
  readonly physiology: {
    readonly energy: number;
    readonly satiety: number;
    readonly health: number;
  };
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: Readonly<Record<string, number>>;
};

export function summarizeObservedAgentState(agent: ObservedAgentStateSummaryInput): string {
  return [
    `energy=${agent.physiology.energy}`,
    `satiety=${agent.physiology.satiety}`,
    `health=${agent.physiology.health}`,
    `education=${agent.educationScore}`,
    `balance=${agent.balance}`,
    `residentialTier=${agent.residentialTier}`,
    `job=${agent.job ?? 'unemployed'}`,
    `inventory=${summarizeInventory(agent.inventory)}`,
  ].join(' ');
}

function summarizeInventory(inventory: Readonly<Record<string, number>>): string {
  const entries = Object.entries(inventory)
    .filter(([, quantity]) => quantity !== 0)
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return 'empty';
  }

  return entries.map(([itemName, quantity]) => `${itemName}:${quantity}`).join(',');
}

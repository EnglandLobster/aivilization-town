export type CommodityConsumptionRule =
  | {
      readonly kind: 'consumable';
      readonly utilityPoints: number;
    }
  | {
      readonly kind: 'durable';
      readonly utilityPoints: number;
      readonly lifetimeSeconds: number;
    };

export type ConsumptionPolicy = {
  readonly policyVersion: string;
  readonly rules: Readonly<Record<string, CommodityConsumptionRule>>;
};

export function resolveCommodityConsumptionRule(
  policy: ConsumptionPolicy,
  commodityName: string,
): CommodityConsumptionRule | undefined {
  assertValidConsumptionPolicy(policy);
  return policy.rules[commodityName];
}

export function assertValidConsumptionPolicy(policy: ConsumptionPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('consumption policyVersion must not be empty');
  }
  for (const [commodityName, rule] of Object.entries(policy.rules)) {
    if (commodityName.trim().length === 0) {
      throw new Error('consumption commodity name must not be empty');
    }
    assertPositiveFinite(rule.utilityPoints, `${commodityName} utilityPoints`);
    if (rule.kind === 'durable') {
      assertPositiveFinite(rule.lifetimeSeconds, `${commodityName} lifetimeSeconds`);
    }
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}

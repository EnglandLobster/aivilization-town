export type ActivityType =
  | 'ReceiveEducation'
  | 'RecoverHealth'
  | 'RecoverEnergy'
  | 'RecoverSatiety'
  | 'Work'
  | 'Produce'
  | 'Trade';

export type ActivityConfig = {
  readonly type: ActivityType;
  readonly names: readonly string[];
  readonly source: string;
};

const activitySource = 'AIvilization v0 Appendix B Table 8';

export const activities = [
  {
    type: 'ReceiveEducation',
    names: ['paid learning', 'reading', 'self study'],
    source: activitySource,
  },
  { type: 'RecoverHealth', names: ['see doctor'], source: activitySource },
  { type: 'RecoverEnergy', names: ['sleep'], source: activitySource },
  { type: 'RecoverSatiety', names: ['eat'], source: activitySource },
  { type: 'Work', names: ['work'], source: activitySource },
  { type: 'Produce', names: ['craft'], source: activitySource },
  { type: 'Trade', names: ['buy', 'sell'], source: activitySource },
] as const satisfies readonly ActivityConfig[];

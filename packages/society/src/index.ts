export * from './education';
export * from './educationSystem';
export * from './educationExam';
export * from './calendar';
export * from './collectiveAction';
export * from './conditions';
export * from './consumption';
export * from './discourse';
export * from './healthcare';
export * from './landValue';
export * from './lifecycle';
export * from './migration';
export * from './lifestyle';
export * from './occupation-catalog';
export * from './occupation';
export * from './physiology';
export * from './publicBudget';
export * from './recruitment';
export * from './residential';
export * from './social';
export * from './tax';
export * from './wage';
export * from './welfare';
export * from './wellbeing';

export type SocietyModuleStatus = {
  readonly packageName: '@aivilization/society';
  readonly owns: 'education-occupation-relationships';
};

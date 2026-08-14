export * from './education';
export * from './conditions';
export * from './consumption';
export * from './healthcare';
export * from './landValue';
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

export type SocietyModuleStatus = {
  readonly packageName: '@aivilization/society';
  readonly owns: 'education-occupation-relationships';
};

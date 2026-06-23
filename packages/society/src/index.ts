export * from './education';
export * from './occupation';
export * from './physiology';
export * from './wage';

export type SocietyModuleStatus = {
  readonly packageName: '@aivilization/society';
  readonly owns: 'education-occupation-relationships';
};

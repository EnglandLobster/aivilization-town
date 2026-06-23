export * from './education';
export * from './occupation';
export * from './physiology';
export * from './residential';
export * from './social';
export * from './wage';

export type SocietyModuleStatus = {
  readonly packageName: '@aivilization/society';
  readonly owns: 'education-occupation-relationships';
};

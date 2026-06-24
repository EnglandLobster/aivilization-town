export * from './education';
export * from './healthcare';
export * from './occupation-catalog';
export * from './occupation';
export * from './physiology';
export * from './residential';
export * from './social';
export * from './wage';
export * from './welfare';

export type SocietyModuleStatus = {
  readonly packageName: '@aivilization/society';
  readonly owns: 'education-occupation-relationships';
};

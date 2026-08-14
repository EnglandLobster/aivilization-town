export * from './aggregate';
export * from './lifecycle';
export * from './model';
export * from './policy';

export type EnterpriseModuleStatus = {
  readonly packageName: '@aivilization/enterprise';
  readonly owns: 'enterprise-aggregate-and-lifecycle-invariants';
};

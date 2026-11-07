import type { OpenSocietyRuntime } from './runtime';
import type { OpenSocietyState } from './types';
import type { OpenToolResult } from '@aivilization/agent-runtime';

/** Explicit administrative phase: reuse existing versioned domain transitions, never scenario factories. */
export const SOCIETY_FOUNDATIONS_ACTIVATION_VERSION = 'society-foundations-activation-v1';
const foundationSteps = [
  ['life', 'enableLife', (s: OpenSocietyState) => !!s.life],
  ['kernel', 'enableSocietyKernel', (s: OpenSocietyState) => !!s.sharedRecords && !!s.coordination],
  ['record-views', 'enableRecordViews', (s: OpenSocietyState) => !!s.recordViews],
  ['collectives', 'enableCollectives', (s: OpenSocietyState) => !!s.collectives],
  ['common-accounts', 'enableCommonAccounts', (s: OpenSocietyState) => !!s.world.commonAccounts],
  ['resource-control', 'enableResourceControl', (s: OpenSocietyState) => !!s.resourceControlPolicy],
  [
    'group-control',
    'enableGroupControl',
    (s: OpenSocietyState) => !!s.communication?.groupControlPolicy,
  ],
  ['materials', 'enableMaterials', (s: OpenSocietyState) => !!s.world.materials],
  ['premises', 'enablePremises', (s: OpenSocietyState) => !!s.world.premises],
] as const;
/** Each step is durable and atomic. A rejected step stops the phase; a retry resumes its recorded prefix. */
type ActivationMethod = Extract<
  keyof OpenSocietyRuntime,
  `enable${string}` | 'upgradeServiceProviders'
>;
type ParameterlessActivation = {
  [K in ActivationMethod]: OpenSocietyRuntime[K] extends () => OpenToolResult ? K : never;
}[ActivationMethod];
type Step = readonly [string, ParameterlessActivation, (s: OpenSocietyState) => boolean];
function activate(
  runtime: OpenSocietyRuntime,
  version: string,
  steps: readonly Step[],
  scope: string,
) {
  const completed: string[] = [];
  const report = (status: 'enabled' | 'blocked', reason?: string) => ({
    version,
    status,
    completed,
    features: steps.map(([feature, , enabled]) => ({ feature, enabled: enabled(runtime.state) })),
    ...(reason ? { reason } : {}),
    scope,
  });
  if (
    Object.values(runtime.state.residents).some(
      (r) =>
        r.activeTurnId !== undefined &&
        !runtime.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
    )
  )
    return report('blocked', 'resident-turn-active');
  for (const [name, method, enabled] of steps) {
    if (!enabled(runtime.state)) {
      const result = runtime[method]();
      if (!result.ok) return report('blocked', `${name}:${result.error}`);
      if (!enabled(runtime.state)) throw new Error(`society-foundation-not-applied:${name}`);
    }
    completed.push(name);
  }
  return report('enabled');
}

export function activateSocietyFoundations(runtime: OpenSocietyRuntime) {
  return activate(
    runtime,
    SOCIETY_FOUNDATIONS_ACTIVATION_VERSION,
    foundationSteps,
    'foundations-only-no-assets-or-complete-profile',
  );
}
export const SOCIETY_SERVICES_ACTIVATION_VERSION = 'society-services-activation-v1';
const serviceSteps = [
  [
    'providers',
    'upgradeServiceProviders',
    (s: OpenSocietyState) => s.services?.policy.version === 'resident-services-v3',
  ],
  ['service-control', 'enableServiceControl', (s: OpenSocietyState) => !!s.services?.controlPolicy],
  [
    'service-principals',
    'enableServicePrincipals',
    (s: OpenSocietyState) => !!s.services?.principalPolicy,
  ],
  ['service-supply', 'enableServiceSupply', (s: OpenSocietyState) => !!s.services?.registration],
  [
    'service-affiliations',
    'enableServiceAffiliations',
    (s: OpenSocietyState) => !!s.services?.affiliations,
  ],
  [
    'service-relations',
    'enableServiceSupplyRelations',
    (s: OpenSocietyState) => !!s.services?.relationPolicy,
  ],
] as const;
export function activateSocietyServices(runtime: OpenSocietyRuntime) {
  if (runtime.state.services && !runtime.state.world.publicGovernance)
    return {
      version: SOCIETY_SERVICES_ACTIVATION_VERSION,
      status: 'blocked' as const,
      completed: [] as string[],
      features: serviceSteps.map(([feature, , enabled]) => ({
        feature,
        enabled: enabled(runtime.state),
      })),
      reason: 'public-governance-not-enabled',
      scope: 'service-directory-no-providers-facilities-or-complete-profile',
    };
  return activate(
    runtime,
    SOCIETY_SERVICES_ACTIVATION_VERSION,
    serviceSteps,
    'service-directory-no-providers-facilities-or-complete-profile',
  );
}

/** Version 2 separates directory capability from permission to use public resources. */
export function activateIndependentSocietyServices(runtime: OpenSocietyRuntime) {
  const steps: readonly Step[] = serviceSteps.map(
    (step): Step =>
      step[0] === 'service-principals'
        ? [
            'service-principals',
            'enableIndependentServicePrincipals',
            (s) => s.services?.principalPolicy?.version === 'resident-service-principals-v3',
          ]
        : step,
  );
  return activate(
    runtime,
    'society-services-activation-v2',
    steps,
    'service-directory-no-public-grants-providers-or-facilities',
  );
}

/** Only elapsed sleep and learning; wage terms and material endowments require separate declarations. */
export function activateSocietyBodyLearning(runtime: OpenSocietyRuntime) {
  return activate(
    runtime,
    'society-body-learning-activation-v1',
    [
      ['elapsed-rest', 'enableElapsedRest', (s) => !!s.world.residentRest],
      ['elapsed-study', 'enableElapsedStudy', (s) => !!s.world.residentStudy],
    ],
    'elapsed-sleep-and-learning-no-wage-policy-or-material-seeding',
  );
}

/** Connect real delivery and payroll without creating providers, facilities, prices or consent. */
export function activateSocietyLivelihoods(runtime: OpenSocietyRuntime) {
  return activate(
    runtime,
    'society-livelihoods-activation-v1',
    [
      ['service-engagements', 'enableServiceEngagements', (s) => !!s.world.serviceEngagements],
      ['service-time', 'enableServiceTime', (s) => !!s.world.serviceTime],
      ['service-employment', 'enableServiceEmployment', (s) => !!s.world.serviceEmployment],
      [
        'productive-employment',
        'enableProductiveEmployment',
        (s) => !!s.world.productiveEmployment,
      ],
    ],
    'actual-delivery-and-payroll-no-facilities-providers-prices-or-consent',
  );
}

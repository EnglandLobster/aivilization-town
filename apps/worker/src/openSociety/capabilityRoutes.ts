/** Version of the resident CLI contract and generated on-demand Skill, shared with manifest provenance. */
export const RESIDENT_CLI_VERSION = 'resident-cli-v4';
export const RESIDENT_SKILL_VERSION = 'town-resident-skill-v79';
const worldRoutes: Readonly<Record<string, string>> = {
  observe: 'city observe',
  move: 'travel go',
  eat: 'life eat',
  consume: 'life consume',
  sleep: 'life sleep',
  stop_rest: 'life wake',
  doctor: 'life doctor',
  study: 'education study',
  stop_study: 'education stop',
  trade: 'market trade',
  work: 'business work',
  stop_work: 'life stop-work',
  claim_wage: 'business claim-wage',
  produce: 'business produce',
  apply_job: 'business apply-job',
  give: 'market give',
  found_enterprise: 'business found',
  join_enterprise: 'business join',
  leave_enterprise: 'business leave',
  layoff_employee: 'business layoff',
  fund_enterprise: 'business fund',
  close_enterprise: 'business close',
  post_job: 'business post-job',
  deposit: 'bank deposit',
  withdraw: 'bank withdraw',
  borrow: 'bank borrow',
  export: 'market export',
  import: 'market import',
  upgrade_home: 'housing upgrade',
  choose_residence: 'housing choose',
  build_housing: 'housing build',
  apply_exam: 'education apply-exam',
};

/** Canonical CLI route used by discovery and the resident adapter. */
export function residentCapabilityRoute(name: string): string {
  const [category, operation] = name.split('.');
  if (!category || !operation || name.split('.').length !== 2)
    throw new Error(`invalid-capability-name:${name}`);
  const route = category === 'world' ? worldRoutes[operation] : `${category} ${operation}`;
  if (!route) throw new Error(`missing-cli-route:${name}`);
  return route;
}

import type { OpenToolDefinition } from '@aivilization/agent-runtime';

export const SOCIETY_RULEBOOK_VERSION = 'society-rulebook-v59';
type RuleKind =
  | 'integrity'
  | 'world-model'
  | 'initial-institution'
  | 'resident-institution'
  | 'interpretation';
type Rule = {
  id: string;
  kind: RuleKind;
  domain: string;
  description: string;
  changeAuthority: string;
  limits: string;
  groups: readonly string[];
};
export const SOCIETY_RULES: readonly Rule[] = [
  {
    id: 'agreed-labor',
    kind: 'resident-institution',
    domain: 'enterprise/world',
    description:
      'Explicit accepted-enterprise-labor-terms-v1 uses an employer offer and the named employee independent acceptance for ordinary work, production and service wages.',
    changeAuthority:
      'Current enterprise controller offers or withdraws pending terms; only the named employee accepts or declines. Collective management requires an exact independently approved principal operation.',
    limits:
      'Query town business labor-terms; act through town business change-labor-terms. Terms specify wageMicros, referenceMs and validity. Acceptance does not start work. Each actual start freezes its rate; new terms do not reprice old work or erase wages. Production and service funding authorization also bind that rate. Initial jobs without a consenting enterprise are not silently converted. Existing labor modes require a separate explicit transition.',
    groups: ['business', 'production', 'engagements', 'principals'],
  },
  {
    id: 'fiscal-observation',
    kind: 'initial-institution',
    domain: 'world-read-adapter',
    description:
      'Public disclosure of current treasury and bounded aggregate IncomeTaxCharged, TradeTaxCharged, DividendTaxCharged and SubsidyPaid facts through town city observe --view fiscal.',
    changeAuthority: 'Versioned adapter disclosure contract; reading never enacts fiscal policy.',
    limits:
      'Only declared event kinds within the returned coverage; other settlement paths excluded. No private identities, balances or raw contracts. Cursor pages distinguish treasury and minted payments; no claim of complete reconciliation or resident consensus.',
    groups: [],
  },
  {
    id: 'finite-periodic-obligations',
    kind: 'resident-institution',
    domain: 'commerce/enterprise/economy/governance/world',
    description:
      'Explicit resident-periodic-obligations-v1 freezes a finite zero-interest payment promise. Actual installments, unpaid claims and future cessation are separate facts, not a lease, loan, service or membership created by a name.',
    changeAuthority:
      'Payer offers; actual revenue subject independently accepts whole original terms. Current exact personal, enterprise, collective or separate public-finite-periodic-commitments-v1 authority controls later actions. System executes only original fixed periods without impersonating a resident.',
    limits:
      'Each period pays once using real accounts or records a stable unpaid reason. No minting, automatic retry, interest, infinite renewal or program delegation. Either original party may stop future periods only; creditor can independently waive exact unpaid claims. Existing debt and receivables block closing, enterprise arrears block dividends. No private balance is returned in prepare/read; details are requested with town obligations list/read/prepare and precise principals operate. Bankruptcy/estate and full-mode integration remain separate original-goal work.',
    groups: ['obligations', 'principals', 'funds', 'collectives', 'governance'],
  },
  {
    id: 'resource-principals',
    kind: 'resident-institution',
    domain: 'authority/materials/premises/mobility/enterprise/governance/world',
    description:
      'Stock custody and explicitly enabled construction distinguish personal, collective, enterprise and public subjects from the actual resident executor. Author, capital holder, manager and user are separate.',
    changeAuthority:
      'Personal consent, current enterprise management, or the exact independently approved collective/public decision. Query town principals read for current versions and operation inputs.',
    limits:
      'Stock operations include explicit project material reservations. Enabled premises principals support exact project creation/cancellation and building administration; actual materials and personal elapsed work create the building, owned by its principal rather than its last worker. Building custody additionally requires bilateral independent consent and preserves accepted usage. Explicit principal-permits-v2 connects exact named organizational use contracts; Explicit principal-trade-v3 atomically escrows exact buyer accounts, consent and provision, retaining original subject pay/refund accounts; actual availability never implies personal participation or subjective fulfillment. Transfers preserve material, reservations, history and permissions. Expired or stale approval cannot execute, and failure does not consume it. No proposal compels personal work or makes the executor a private owner. Explicit vehicle-principals-v2 independently connects vehicle control and named driver permissions. Bookings/journeys block authority changes and actual entrusted cargo blocks driver revocation. Control is not driving, personal labor or assignment of old fare income. Explicit service-principals-v2 connects directory control, exact management and named providers through the unique directory journal. Manager authority does not imply body permission, fees or enterprise wages. Actual appointments and provider shifts prevent closure; directory control and supply obligations block enterprise cash-only liquidation. Explicit resource-sales-v1 quotes actual built premises and atomically pays exact subject accounts and accepts control. Declining price never permits free acceptance; withdrawing cancels its same handover. Public fiscal acquisition needs its own explicit grant, not mere management. Old author, permissions, location and obligations persist. Enterprise cash-surplus accounting is not fixed-asset capitalization. Explicit resource-sales-v2 additionally prices current stock and vehicle control through their owning domains. Stock purchase does not move goods or convey land/buildings; vehicle purchase preserves entrusted cargo, named drivers and original fare obligations. Actual source/obligation drift invalidates the price. Public stock/vehicle purchase requires independent consent captured under the extended fiscal scope; previous ballots cannot inherit new asset kinds. Enterprise receipts keep versioned actual cash sources, not a second physical or valuation ledger. Independent-resource-adapters-v1 connects explicitly selected existing domains without granting public authority or requiring unrelated assets. Query resourceAdapters for the enabled kinds; public fiscal scope still requires its own grant. Remaining resource domains require explicit integration.',
    groups: ['principals', 'stocks', 'production', 'collectives', 'governance'],
  },
  {
    id: 'housing-occupancy',
    kind: 'world-model',
    domain: 'society/premises/world',
    description:
      'Registered residence, physical location, current use permission and title are distinct facts. Constructed space requires real material, work, capacity and permission.',
    changeAuthority:
      'Only the resident may release their exact registered residence; personal revision changes on real move-in and departure. Query town housing occupancy.',
    limits:
      'A permit expiry does not teleport or evict anyone; continued occupation does not grant a new permit. Leaving registration releases its capacity, but not bodily presence, private rent, deposits, debts or contracts. Use independent contract and travel actions. No private title to initial public homes is inferred.',
    groups: ['housing', 'premises', 'permits', 'leases'],
  },
  {
    id: 'public-housing',
    kind: 'resident-institution',
    domain: 'governance/society/world',
    description:
      'Explicitly granted public procedures can amend initial housing service tariffs and upgrade eligibility at execution time.',
    changeAuthority:
      'Independent ballots under the existing public procedure; complete exact terms and current policy revision. Read town governance housing.',
    limits:
      'Explicit migration preserves all past debt, resident standards and assets; future arrears are recorded without forced standard change or forgiveness. Private rent, physical buildings, physiological parameters and debt remedies remain separate. Existing standard set is fixed by the world model. Housing service costs currently leave circulation for the external initial provider.',
    groups: ['governance', 'housing'],
  },
  {
    id: 'capital-agreements',
    kind: 'resident-institution',
    domain: 'enterprise/economy/authority/world',
    description:
      'Residents choose executable capital rights and exact contributions or private transfer prices. Every affected holder and payer independently accepts; receiving company cash needs separate current management consent.',
    changeAuthority:
      'Personal controllers or exact approved collective resource actions. Capital weights do not define management votes, employment or fixed debt repayment.',
    limits:
      'Old fund commands do not buy rights. Accepted contributions are real escrow; failed, expired or superseded agreements refund original accounts. Investment is not operating profit; distributions reach actual right holders. Legacy owner-only liquidation cannot erase new rights or obligations.',
    groups: ['capital', 'business', 'collectives', 'funds'],
  },
  {
    id: 'public-employment',
    kind: 'resident-institution',
    domain: 'governance/society/world',
    description:
      'Explicitly granted public decisions can amend existing public job admission, quotas, ranking and capacity from the next recruitment cycle.',
    changeAuthority:
      'Independent ballots and execution under the existing public procedure; exact full terms, expected policy revision, immutable proposal source.',
    limits:
      'Initial rules inherit the scenario; activation itself does not reform admission. No retroactive admissions, automatic applications, private staff changes, qualifications, money or physical effects. Read town governance employment for active and scheduled revisions.',
    groups: ['governance', 'business'],
  },
  {
    id: 'public-procedures',
    kind: 'initial-institution',
    domain: 'governance/society/world',
    description:
      'Explicitly granted public scope and a resident-amendable procedure bind independently cast ballots to exact policy terms. Approved execution changes the existing enacted policy atomically.',
    changeAuthority:
      'The scenario supplies initial public scope. Residents amend procedure through its current rules; an amendment supersedes unused old procedural authority.',
    limits:
      'No private group, topic petition or objection creates arbitrary governing power. An explicitly granted procurement extension can fund an exact accepted public service contract from treasury; participants still decide their own attendance. It disables abstract automatic budget allocations. Recorded approval is not truth; executed effects are never erased.',
    groups: ['governance'],
  },
  {
    id: 'premises-use-rights',
    kind: 'resident-institution',
    domain: 'premises/authority/world',
    description:
      'Independent accepted grants provide fixed named users, scopes and time windows. Shared use remains capacity limited; exclusive use prevents conflicting new uses.',
    changeAuthority:
      'Residents choose terms, recipients, users, scopes and time; current resource authority signs, the recipient independently accepts. Changes to executable rights semantics require a versioned extension.',
    limits:
      'No unilateral revocation of accepted fixed terms, forced participation/eviction, erased goods or lost elapsed labor. Rights survive control transfer; physical damage remains real. Paid rights in evidence-trade v2 atomically pair price escrow and permission acceptance; available permission time is recorded separately from attendance and satisfaction.',
    groups: ['permits'],
  },
  {
    id: 'evidence-trade',
    kind: 'resident-institution',
    domain: 'commerce/logistics/services/premises/economy/world',
    description:
      'Resident-priced orders bind one unstarted real source. Private acceptance escrows the price; explicitly enabled treasury freight separates buyer consent from exact public funding approval; actual goods arrival, recorded service time or available permission time establishes fulfillment, separately from satisfaction.',
    changeAuthority:
      'Residents choose prices, parties, purpose and original dispute/settlement terms. Changing supported proof types or settlement arithmetic requires a versioned extension.',
    limits:
      'No delivery by statement, source reuse, payment without consent, hidden service double billing or automatic quality verdict. In-transit cancellation retains obligations until actual return. Partial service returns the unperformed amount. Public freight refunds return to the original treasury; public funding does not create public property.',
    groups: ['trades'],
  },
  {
    id: 'freight-custody-handoff',
    kind: 'initial-institution',
    domain: 'logistics/authority/world',
    description:
      'Explicit freight-custody-handoff-v1 requires exact independent source, receiver, payer and living prior custodian approval, then personal acceptance by the successor. This consent protocol is an initial contract institution, not a physical law.',
    changeAuthority:
      'Residents choose whether, whom and when to propose, consent, withdraw or personally accept. Changing the enforced consent protocol requires an explicit versioned extension; prose does not amend it.',
    limits:
      'Query freight.rules for personal and separate collective activation. Exact collective proposal, consent or withdrawal consumes its decision atomically. Executed consent remains specific to its proposal and current charter version, independent of the historical representative being alive. Personal acceptance cannot be delegated. Cargo and original fees remain unchanged; interrupted route recovery is not yet connected.',
    groups: ['freight'],
  },
  {
    id: 'physical-freight',
    kind: 'world-model',
    domain: 'logistics/materials/mobility/world',
    description:
      'Cargo remains a single conserved physical consignment. Independent receiver consent reserves destination space; loaded goods move only with their actual carrier or vehicle. Normal inventory counts toward finite loads.',
    changeAuthority:
      'Residents choose purpose, counterparties, fees, routes and organization. Physical load units and vehicle endowments require versioned explicit extension.',
    limits:
      'No delivery by text, no consuming entrusted cargo, no timeout teleportation or erased obligation. After loading, cancellation requires actual return and agreed settlement. Driving authority does not transfer cargo custody.',
    groups: ['freight', 'vehicles', 'stocks'],
  },
  {
    id: 'physical-service-delivery',
    kind: 'world-model',
    domain: 'services/society/materials/premises/world',
    description:
      'Actual service requires independently accepted terms, real escrow, voluntary personal participation, held inputs and measured overlapping time. Registered effects can alter physiology or knowledge within explicit bounds.',
    changeAuthority:
      'Residents choose purpose, prices, participants and income allocation. New physical effects require versioned extension. Explicit seed facilities are initial assets, not consensus or resident construction.',
    limits:
      'Payment and group membership never authorize another body. Names or reviews grant no effect or credential. Exit refunds unearned money and unused materials; reusable tools return. Private bodily state remains visible only to its subject. Explicit service-employment-v1 keeps enterprise financial authorization separate from independent bodily participation, prices, service shares and wages; attendance or effective-service wage basis is chosen and accepted explicitly. Unused prepayment returns without profit, and earned wage debt survives exit.',
    groups: ['engagements', 'business'],
  },

  {
    id: 'physical-facility-use',
    kind: 'world-model',
    domain: 'premises/materials/world',
    description:
      'Explicit facility-use-v1 counts all located stock, held inputs and reserved future outputs against built storage, and personally started processing sessions against real workstations.',
    changeAuthority:
      'Residents build and configure real facilities; changes to unit-volume or station semantics require a versioned model extension. Older construction worlds require explicit preflight activation.',
    limits:
      'Names, public entry and collective membership create no workstations or storage. Actual existing goods and labor cannot be removed during upgrade. Care and teaching effects still require their separate supply contracts.',
    groups: ['stocks', 'production', 'premises'],
  },

  {
    id: 'construction-procurement',
    kind: 'world-model',
    domain: 'commerce/premises/governance/world',
    description:
      'Explicit construction-trade-v1 binds an unchanged actual project to independently accepted original parties, price and accounts. Unpaid offers expire; funded escrow and physical responsibilities persist. Real completion permits full payment; disputed partial work needs independent settlement.',
    changeAuthority:
      'Residents choose counterparties, prices and original terms. Public procurement uses explicit public-construction-trade-v1 consent; collective money requires its exact decision. No operation compels labor or decides subjective quality.',
    limits:
      'Explicit activation only. No automatic subjective acceptance, forced labor or expiry of funded responsibilities. Full operation and terms are queried on demand.',
    groups: ['principals', 'construction', 'collectives', 'governance'],
  },
  {
    id: 'physical-premises',
    kind: 'world-model',
    domain: 'premises/materials/world',
    description:
      'Finite sites and immutable blueprints require independently reserved material inputs and actual personal work. Completion alone creates reachable space; physical aging, maintenance and demolition remain recorded.',
    changeAuthority:
      'Physical conversion and geometry are versioned model extensions. Residents choose purpose, configuration, partners and authorized use within those capabilities.',
    limits:
      'A title is not a building, work order is not labor, public entry is not residence or operating control, and fixtures are not staffed services. Unsettled obligations block closing or demolition.',
    groups: ['sites', 'construction', 'premises', 'materials'],
  },
  {
    id: 'public-construction-use',
    kind: 'initial-institution',
    domain: 'premises/public-land',
    description:
      'The explicit initial land rule grants finite area for funded construction without choosing builders. Physical land and this permission rule have distinct provenance.',
    changeAuthority:
      'Public procedure authority must amend future grants under G02. No ordinary file or CLI may invent land or rewrite past permits.',
    limits:
      'Scenario seed sites are initial geometry, not purchases or resident consensus. Old worlds require an explicit authorized extension; enabling construction alone seeds no land.',
    groups: ['sites', 'construction'],
  },

  {
    id: 'material-production',
    kind: 'world-model',
    domain: 'materials/world',
    description:
      'Located stocks and reserved real inputs become outputs only through registered conversions and actual personally performed labor.',
    changeAuthority:
      'Resident controllers choose products and schedules; physical conversion policy is a versioned model. Collective resource actions require exact decisions, and workers independently start/leave.',
    limits:
      'An empty record creates no land, building or goods. Product labels confer no physical effects. Actual time, effort, stock and escrow settle atomically; no wages or cash are minted. Explicit productive-employment mode lets a real employer authorize a task and its contracted workers. Personal production earns wages from actual receipts, consuming body time/effort once. Enterprise cash pays wages and tax; shortfalls remain personal debt. Output remains in the actual named stock, not automatically enterprise property.',
    groups: ['stocks', 'production', 'sources'],
  },

  {
    id: 'group-control',
    kind: 'resident-institution',
    domain: 'authority/information',
    description:
      'Group administration follows independently accepted personal or collective control, separately from membership and messages.',
    changeAuthority:
      'The current controller manages admission or offers a handover; each resident alone accepts an invitation, requests admission, leaves or writes a message.',
    limits:
      'Control grants no membership or history access. Handover cancels pending invitations and requests with the actual reason; requests remain withdrawable. Legacy groups change control only through explicit migration and handover.',
    groups: ['groups', 'resources'],
  },
  {
    id: 'enterprise-management-control',
    kind: 'resident-institution',
    domain: 'enterprise/authority',
    description:
      'Independently accepted personal or collective enterprise management, distinct from capital rights and personal labor.',
    changeAuthority:
      'Current controller offers management; target independently accepts. Collective management binds exact action, company and control version.',
    limits:
      'Management cannot rewrite shares or existing claims, delegate bodies or impersonate the founder. Failed spending consumes no decision. Closure protects obligations and returns residual assets to recorded capital holders. Explicit capital agreements provide issuance and transfers through capital commands; complete succession and in-kind liquidation remain unsupported. Paid atomic management exchange requires explicitly enabled program-actions-v3.',
    groups: ['resources', 'business', 'collectives', 'production', 'market'],
  },
  {
    id: 'resource-control',
    kind: 'resident-institution',
    domain: 'authority/information',
    description:
      'Versioned control and independently accepted handovers, separate from authorship, usage permissions and physical obligations.',
    changeAuthority:
      'The current resident controller or exact collective decision offers or changes management; the target independently accepts.',
    limits:
      'Founding and titles grant no permanent admin privilege. Collective control grants no implicit content access, personal consent or body delegation. Only domain-supported operations execute.',
    groups: ['resources'],
  },
  {
    id: 'resident-program-reactions',
    kind: 'resident-institution',
    domain: 'collaboration',
    description:
      'Finite durable reevaluations on committed dependency changes, with explicit progress and termination.',
    changeAuthority:
      'The authenticated runner registers or cancels a watch; every principal retains their separate revocable mandate.',
    limits:
      'A queue item grants no authority; current facts and source ACL are rechecked. Failure stops, no infinite retries. Clock-only triggers use schedules.',
    groups: ['reactions'],
  },
  {
    id: 'resident-program-conditions',
    kind: 'resident-institution',
    domain: 'collaboration/information/world',
    description:
      'Resident-authored bounded predicates over currently authorized source versions, with claim and fact provenance preserved.',
    changeAuthority:
      'Program author defines the predicates; all principals independently authorize the exact program revision; every source keeps its current visibility.',
    limits:
      'Condition success grants no extra authority, certifies no subjective claim, cannot proxy private facts to unauthorized participants, and never replaces the domains real effect checks.',
    groups: ['programs'],
  },
  {
    id: 'common-accounts',
    kind: 'resident-institution',
    domain: 'economy/world',
    description: 'Real circulating cash accounts controlled by resident collective procedures.',
    changeAuthority:
      'Members open empty accounts; individuals voluntarily contribute; exact passed collective decisions authorize spending and settlement.',
    limits:
      'A title, contribution or founder role grants no individual withdrawal, equity or debt. Transfers preserve money supply; unsupported resource effects remain unavailable.',
    groups: ['funds'],
  },
  {
    id: 'resident-collectives',
    kind: 'resident-institution',
    domain: 'collaboration',
    description:
      'Resident-authored charters, individual membership consent, frozen decision procedures and finite authority proofs.',
    changeAuthority:
      'Founders independently accept; amendments follow the old charter with additional joining consent from new members.',
    limits:
      'A passed statement creates no assets or public authority. Real resource effects require a supported domain adapter and atomic proof consumption. Exit never transfers property or chooses a successor.',
    groups: ['collectives'],
  },
  {
    id: 'resident-data-views',
    kind: 'interpretation',
    domain: 'information',
    description:
      'Resident-authored queries and calculations over authorized shared records, retaining definition and input versions.',
    changeAuthority:
      'The view author chooses the definition; each reader also needs current source access.',
    limits:
      'Computed scores and aggregates remain attributed resident interpretations. They are not platform ratings, balances, membership authority or objective truth.',
    groups: ['views'],
  },
  {
    id: 'integrity',
    kind: 'integrity',
    domain: 'sim-core/world',
    description: 'Identity, atomic facts, balanced transfers, idempotency and replay.',
    changeAuthority: 'Versioned engineering migration only.',
    limits: 'Text and model output cannot overwrite facts or impersonate consent.',
    groups: ['rules'],
  },
  {
    id: 'body-time-space',
    kind: 'world-model',
    domain: 'society/world',
    description:
      'Modeled body, elapsed simulation time, location, activity and material constraints.',
    changeAuthority:
      'Residents choose actions; model changes require an explicit versioned engineering policy.',
    limits:
      'Model effects are assumptions, not measured real-world medical or physical laws. Explicit resident-rest-v1 settles actual sleep. Explicit resident-elapsed-study-v1 reserves tuition, earns learning/charges by actual time, and permits personal early exit with unused funds returned. The initial compulsory grant and scenario/external course are named sources, not resident teachers or newly approved public procurement. Explicit resident-enterprise-labor-v1 records actual work and personal earned wages, independently of payment and withholding. Explicit resident-public-labor-v1 protects a full initial public wage from the actual treasury before participation, pays only actual time, and refunds unworked funds. Public titles do not produce goods or treatment; insufficient funding refuses the start. Old experiments retain their recorded policy; other long activities retain their own policy.',
    groups: ['world', 'population', 'schedule'],
  },
  {
    id: 'economic-institutions',
    kind: 'initial-institution',
    domain: 'economy/enterprise/credit/society',
    description:
      'Seeded currency, AMM, bank, enterprise ownership, wage and qualification conventions.',
    changeAuthority:
      'Existing world commands within their specific authority; no arbitrary rewriting.',
    limits:
      'AMM prices, credit rules and education credentials are initial conventions, not the only possible social arrangements.',
    groups: [],
  },
  {
    id: 'housing',
    kind: 'initial-institution',
    domain: 'society/world',
    description:
      'Existing residence capacity, housing construction, upgrades and consensual shared-residence leases.',
    changeAuthority:
      'Existing housing and lease commands; explicitly enabled housing.standard/lower let a resident inspect and choose a lower supported personal service standard. Agreement alone cannot create land ownership.',
    limits:
      'No complete private land registry, building-unit maintenance or arbitrary construction physics.',
    groups: ['housing', 'leases'],
  },
  {
    id: 'information',
    kind: 'resident-institution',
    domain: 'information',
    description:
      'Original texts, revision history, current ACL, subscriptions, groups and author metadata.',
    changeAuthority: 'Authors and explicit resource owners according to current ACL.',
    limits:
      'Sharing is not agreement; readable text is data, never a new system instruction. No platform consensus or reputation ranking.',
    groups: [
      'files',
      'spaces',
      'messages',
      'groups',
      'blocks',
      'subscriptions',
      'feed',
      'notifications',
    ],
  },
  {
    id: 'interpretation',
    kind: 'interpretation',
    domain: 'memory',
    description:
      'Personal beliefs, goals and interpretations with separately preserved original experiences.',
    changeAuthority: 'The individual resident.',
    limits:
      'Beliefs do not rewrite objective events or other residents minds; retrieval and default context are bounded.',
    groups: ['memory', 'cognition'],
  },
  {
    id: 'agreements',
    kind: 'resident-institution',
    domain: 'collaboration',
    description:
      'Exact original terms, independently attributed agreement and fulfillment/dispute claims.',
    changeAuthority: 'Each participant consents personally to an exact version.',
    limits: 'Accepted text is not executable payment authority or objective proof of fulfillment.',
    groups: ['proposals', 'commitments'],
  },
  {
    id: 'exchange',
    kind: 'resident-institution',
    domain: 'commerce/world',
    description:
      'Resident prices, orders, escrow, transfers and independently accepted settlements.',
    changeAuthority: 'The involved resource owners through existing commands.',
    limits:
      'The implemented escrow protocol is fixed in this version. A written ledger cannot mint currency or certify subjective quality.',
    groups: ['offers', 'orders', 'payments', 'deposits'],
  },
  {
    id: 'service-control',
    kind: 'resident-institution',
    domain: 'services/authority',
    description:
      'Independently accepted transfer of directory administration, preserving existing slots, bookings and actual provider shifts.',
    changeAuthority:
      'Current controller offers; recipient independently accepts. Explicit activation requires recorded-provider service policy v3.',
    limits:
      'Administration does not move, employ, replace or stop another person. Original author and actual participation remain recorded. Legacy v1 does not support enterprise-linked administration. Explicit service-principals-v2 supports exact collective, enterprise and public administration without changing the original affiliation; linked services require separate precise enterprise affiliation proof. Explicit service-supply-v3 allows creation by an exact actual principal through a positive directory registration version, and reopening without new facilities, providers, bodily labor or income. Management and optional enterprise supply affiliation remain separate. Explicit service-affiliation-v4 lets the actual linked firm independently approve a complete current control request, expiring/revocable and used atomically with the independent receiving control. Firm management approval is consumed once when recorded, never impersonated or executed again at handover. Explicit supply-relations-v5 keeps original employer provenance distinct from current future supply. The directory invites and an actual firm independently accepts; either real party may end future supply after outstanding appointments/provider time clear. No future backing erases old contracts, wages or accounts. Directory custody remains independent after a historical firm closes. Full income/wages and liquidation remain separate implementation work.',
    groups: ['resources', 'services', 'programs'],
  },
  {
    id: 'services',
    kind: 'world-model',
    domain: 'services/world',
    description:
      'Actual attendance, available capacity, provider time and exclusive activity reservations.',
    changeAuthority:
      'Residents publish and choose participation; domain verifies time and capacity.',
    limits:
      'Attendance does not certify satisfaction, wages, treatment or qualifications. Older service policies retain their original semantics.',
    groups: ['services', 'bookings', 'queues', 'courses'],
  },
  {
    id: 'personal-life',
    kind: 'resident-institution',
    domain: 'society/world',
    description:
      'Voluntary household agreements, care participation and patient-controlled original records.',
    changeAuthority: 'Participants and patients within explicit permissions.',
    limits:
      'Family agreement does not prove love, create children or grant arbitrary control over another resident.',
    groups: ['households', 'care', 'health'],
  },
  {
    id: 'mobility',
    kind: 'world-model',
    domain: 'mobility/world',
    description:
      'Finite vehicles, real pickup and shared arrival, with voluntary quotes and fare escrow.',
    changeAuthority: 'Vehicle permissions and independently chosen rides within existing rules.',
    limits:
      'No vehicle manufacture, fuel, mass transit, pooling or automatic dispatch in this version.',
    groups: ['vehicles', 'drivers', 'rides'],
  },
  {
    id: 'public-institutions',
    kind: 'initial-institution',
    domain: 'society/world',
    description: 'Existing petitions, civic matters, public bulletins and governed policies.',
    changeAuthority:
      'Only the existing authorized governance path; documents cannot grant government authority.',
    limits:
      'This kernel adds no arbitrary law enforcement, public taxation authority or automatic verdicts.',
    groups: ['civic'],
  },
  {
    id: 'shared-records',
    kind: 'resident-institution',
    domain: 'information',
    description:
      'Resident-defined flat schemas, shared edits, signed history and explicit ownership handover.',
    changeAuthority: 'Current register owner/ACL; a nominated successor personally accepts.',
    limits:
      'All record values are resident claims. The platform does not promote balances, ratings or member lists to world truth.',
    groups: ['registers', 'records'],
  },
  {
    id: 'resident-program-actions',
    kind: 'integrity',
    domain: 'collaboration/authority',
    description:
      'Explicitly enabled ordered transactions bind every resource, payment, message and record effect to an exact independently mandated step.',
    changeAuthority:
      'Operator explicitly enables the versioned action policy. Each principal separately authorizes an exact resident program version.',
    limits:
      'resource.control supports personal premises, stock, space, register, view and group control; service requires its explicitly enabled control policy. All steps commit together; original authorship, contents, third-party rights and bodily autonomy remain independently owned facts. Enterprise management requires explicit v3; v2 contracts retain their original grammar and authority. Management exchange never transfers equity or extinguishes claims. Vehicle and collective control composition are not yet enabled.',
    groups: ['programs', 'mandates'],
  },
  {
    id: 'resident-programs',
    kind: 'resident-institution',
    domain: 'collaboration',
    description:
      'Versioned finite procedures, exact mandates, bounded manual/simulated-time execution and auditable outcomes.',
    changeAuthority:
      'Owner defines; each principal grants their own fixed steps; named runner executes; principal may revoke.',
    limits:
      'Transfer, original message and shared-record put/append steps; explicit action-policy v2 adds the closed resource.control operation. No host code, recursive procedures, bodily control, new physics or automatic interpretation of contracts.',
    groups: ['programs', 'mandates'],
  },
];
/** Integration metadata only; these labels never settle domain behavior. */
export function capabilityRuleIds(tool: OpenToolDefinition): readonly string[] {
  const worldGroups: Readonly<Record<string, readonly string[]>> = {
    'fiscal-observation': ['observe'],
    'agreed-labor': ['work', 'stop_work', 'claim_wage'],
    'body-time-space': [
      'observe',
      'move',
      'eat',
      'consume',
      'sleep',
      'stop_rest',
      'stop_study',
      'stop_work',
      'doctor',
      'study',
      'work',
      'produce',
      'give',
      'build_housing',
    ],
    'economic-institutions': [
      'claim_wage',
      'doctor',
      'study',
      'trade',
      'work',
      'produce',
      'apply_job',
      'found_enterprise',
      'join_enterprise',
      'leave_enterprise',
      'layoff_employee',
      'fund_enterprise',
      'close_enterprise',
      'post_job',
      'deposit',
      'withdraw',
      'borrow',
      'export',
      'import',
      'apply_exam',
    ],
    housing: ['upgrade_home', 'choose_residence', 'build_housing'],
    'public-institutions': [
      'raise_petition',
      'sign_petition',
      'post_bulletin',
      'raise_matter',
      'respond_matter',
      'assign_matter',
      'close_matter',
    ],
    exchange: ['give'],
  };
  const matches =
    tool.category === 'world'
      ? Object.entries(worldGroups)
          .filter(([, operations]) => operations.includes(tool.name.slice('world.'.length)))
          .map(([id]) => id)
      : SOCIETY_RULES.filter((r) => r.groups.includes(tool.category)).map((r) => r.id);
  if (!matches.length) throw new Error(`unclassified-society-capability:${tool.name}`);
  return [...new Set(['integrity', ...matches])];
}

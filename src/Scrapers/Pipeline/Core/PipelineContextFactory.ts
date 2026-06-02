/**
 * Pipeline context factory — builds the initial context from descriptor.
 */

import type { ScraperCredentials } from '../../Base/Interface.js';
import { createBrowserBackedHeadlessApiMediator } from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import { getDebug as createLogger } from '../Types/Debug.js';
import { none, some } from '../Types/Option.js';
import type { IDiagnosticsState, IPipelineContext } from '../Types/PipelineContext.js';
import type {
  BalanceSlotKey,
  DiscoverySlotKey,
  PhaseEmitSlotKey,
  PhaseStateSlotKey,
  ResultSlotKey,
} from './PipelineContextSlotKeys.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/**
 * Create initial diagnostics state.
 * @param credKeyCount - Number of credential keys for diagnostics.
 * @returns Fresh diagnostics state.
 */
function createDiagnostics(credKeyCount: string): IDiagnosticsState {
  const state: IDiagnosticsState = {
    loginUrl: '',
    finalUrl: none(),
    loginStartMs: Date.now(),
    fetchStartMs: none(),
    lastAction: `init (${credKeyCount} credential keys)`,
    pageTitle: none(),
    warnings: [],
  };
  return state;
}

/**
 * Resolve DI dependencies for the initial context.
 * @param descriptor - The pipeline descriptor.
 * @param credentials - User credentials.
 * @returns Core context fields.
 */
function resolveCoreDeps(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Pick<IPipelineContext, 'options' | 'credentials' | 'companyId' | 'logger' | 'config'> {
  const companyId = descriptor.options.companyId;
  const logger = createLogger(`pipeline-${companyId}`);
  const resolved = resolvePipelineBankConfig(companyId);
  const config = resolved || { urls: { base: '' } };
  return { options: descriptor.options, credentials, companyId, logger, config };
}

/** Phase-level optional slots (browser, mediator, etc.). */
interface IPhaseSlots {
  readonly fetchStrategy: IPipelineContext['fetchStrategy'];
  readonly mediator: IPipelineContext['mediator'];
  readonly apiMediator: IPipelineContext['apiMediator'];
  readonly browser: IPipelineContext['browser'];
}

/** Result-slot field names (re-exported here for legacy IResultSlots backward-compat). */
export type { ResultSlotKey } from './PipelineContextSlotKeys.js';

/** Pipeline-result optional slots (login, dashboard, balance-resolve, etc.). */
type IResultSlots = Pick<IPipelineContext, ResultSlotKey>;

/**
 * Build empty phase-level Option slots.
 * @returns Phase slots set to none().
 */
function emptyPhaseSlots(): IPhaseSlots {
  return { fetchStrategy: none(), mediator: none(), apiMediator: none(), browser: none() };
}

/** Phase-state Options (login / dashboard / scrape / api). */
type PhaseStateOptions = Pick<IResultSlots, PhaseStateSlotKey>;

/** Discovery Options (preLogin / loginField / scrape / account / txn / harvest). */
type DiscoveryOptions = Pick<IResultSlots, DiscoverySlotKey>;

/** Phase-emit Options (auth-discovery / otp-trigger / otp-fill). */
type PhaseEmitOptions = Pick<IResultSlots, PhaseEmitSlotKey>;

/** Balance Options (multi-stage balance pipeline outputs). */
type BalanceOptions = Pick<IResultSlots, BalanceSlotKey>;

/**
 * Phase-state slots — one Option per visible phase output.
 * @returns Phase-state Options set to none().
 */
function emptyPhaseStateOptions(): PhaseStateOptions {
  return { login: none(), dashboard: none(), scrape: none(), api: none() };
}

/**
 * Discovery slots — one Option per discovery contract committed by
 * the pipeline's discovery-owning phases.
 * @returns Discovery Options set to none().
 */
function emptyDiscoveryOptions(): DiscoveryOptions {
  return {
    preLoginDiscovery: none(),
    loginFieldDiscovery: none(),
    scrapeDiscovery: none(),
    accountDiscovery: none(),
    txnEndpoint: none(),
    dashboardTxnHarvest: none(),
  };
}

/**
 * Phase-emit slots — Options committed by phases sealed under the
 * CI quality hardening plan (M1 AUTH-DISCOVERY, M4 OTP-TRIGGER).
 * @returns Phase-emit Options set to none().
 */
function emptyPhaseEmitOptions(): PhaseEmitOptions {
  return { authDiscovery: none(), otpTrigger: none(), otpFill: none() };
}

/**
 * Balance slots — Options for the multi-stage balance-resolve pipeline.
 * @returns Balance Options set to none().
 */
function emptyBalanceOptions(): BalanceOptions {
  return {
    balanceFetchPlan: none(),
    balanceResponsesByBankAccount: none(),
    balanceExtracted: none(),
    balanceValidation: none(),
    balanceResolution: none(),
  };
}

/**
 * Build empty result-level Option slots.
 * @returns Result slots set to none().
 */
function emptyResultSlots(): IResultSlots {
  return {
    ...emptyPhaseStateOptions(),
    ...emptyDiscoveryOptions(),
    ...emptyPhaseEmitOptions(),
    ...emptyBalanceOptions(),
  };
}

/**
 * Build the initial pipeline context from descriptor.
 * @param descriptor - The pipeline descriptor.
 * @param credentials - User credentials.
 * @returns The initial context with all phase fields set to none().
 */
function buildInitialContext(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): IPipelineContext {
  const credKeyCount = String(Object.keys(credentials).length);
  const core = resolveCoreDeps(descriptor, credentials);
  const diag = createDiagnostics(credKeyCount);
  const emptySlots = emptyPhaseSlots();
  const phases = wireHeadlessMediator(descriptor, emptySlots);
  const results: IResultSlots = emptyResultSlots();
  return { ...core, diagnostics: diag, ...phases, ...results, loginAreaReady: false };
}

/** Pair of URLs + optional staticAuth needed to wire the headless ApiMediator. */
interface IHeadlessWiring {
  readonly identity: string;
  readonly graphql: string;
  readonly staticAuth?: string;
  readonly requiresBrowserTls: boolean;
  /** When true, the Camoufox strategy route-intercepts the initial origin nav
   * with a blank HTML stub so subsequent same-origin fetches are not blocked
   * by the bank's Cloudflare interstitial CSP. */
  readonly bypassOriginChallenge: boolean;
}

/**
 * Resolve identity + graphql URLs + optional staticAuth from PIPELINE_BANK_CONFIG.
 * Returns false when the bank is not registered or has no headless block.
 * @param companyId - Target bank company type.
 * @returns Resolved wiring, or false when the lookup fails.
 */
function resolveHeadlessWiring(companyId: IPipelineContext['companyId']): IHeadlessWiring | false {
  const config = resolvePipelineBankConfig(companyId);
  if (config === false || !config.headless) return false;
  const headless = config.headless;
  return {
    identity: headless.identityBase,
    graphql: headless.graphql,
    staticAuth: headless.staticAuth,
    requiresBrowserTls: headless.requiresBrowserTls === true,
    bypassOriginChallenge: headless.bypassOriginChallenge === true,
  };
}

/**
 * Wire the browser-backed headless API mediator. All currently-registered
 * headless banks (OneZero, Pepper, PayBox) opt into `requiresBrowserTls:
 * true` — each bank's identity host either gates Node TLS directly or
 * sits behind a Cloudflare edge whose challenge JS is bypassed via the
 * Camoufox strategy's optional origin-challenge route-intercept (see
 * `CamoufoxIdentityFetchStrategy` constructor `bypassOriginChallenge`
 * flag).
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Wired IApiMediator instance with a dispose hook.
 */
/**
 * Build the `createBrowserBackedHeadlessApiMediator` arg literal from
 * the resolved wiring + companyId. Extracted so the call site below
 * stays inside the project's max-lines-per-function cap.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Args bundle ready to pass into the browser-backed mediator factory.
 */
function buildMediatorArgsForWiring(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): Parameters<typeof createBrowserBackedHeadlessApiMediator>[0] {
  const identityOriginUrl = new URL(wiring.identity).origin;
  return {
    bankHint: companyId,
    identityBaseUrl: wiring.identity,
    identityOriginUrl,
    graphqlUrl: wiring.graphql,
    staticAuth: wiring.staticAuth,
    bypassOriginChallenge: wiring.bypassOriginChallenge,
  };
}

/**
 * Build the browser-backed headless ApiMediator for the supplied wiring.
 * The args literal is assembled by {@link buildMediatorArgsForWiring}
 * so this site stays under the project's max-lines-per-function cap.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Wired ApiMediator instance with a dispose hook.
 */
function buildApiMediatorForWiring(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): ReturnType<typeof createBrowserBackedHeadlessApiMediator> {
  const args = buildMediatorArgsForWiring(companyId, wiring);
  return createBrowserBackedHeadlessApiMediator(args);
}

/**
 * Inject an ApiMediator into the phase slots when the descriptor is headless.
 * @param descriptor - The pipeline descriptor (isHeadless flag).
 * @param slots - Empty phase slots from emptyPhaseSlots().
 * @returns Phase slots with apiMediator populated when applicable.
 */
function wireHeadlessMediator(descriptor: IPipelineDescriptor, slots: IPhaseSlots): IPhaseSlots {
  if (descriptor.isHeadless !== true) return slots;
  const wiring = resolveHeadlessWiring(descriptor.options.companyId);
  if (wiring === false) return slots;
  const apiMediator = buildApiMediatorForWiring(descriptor.options.companyId, wiring);
  return { ...slots, apiMediator: some(apiMediator) };
}

export default buildInitialContext;
export { buildInitialContext };

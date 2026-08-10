/**
 * Pipeline context factory — builds the initial context from descriptor.
 */

import type { ScraperCredentials } from '../../Base/Interface.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import { getDebug as createLogger } from '../Types/Debug.js';
import { none } from '../Types/Option.js';
import type { IDiagnosticsState, IPipelineContext } from '../Types/PipelineContext.js';
import { resolveHeadlessApiMediator } from './HeadlessMediatorWiring.js';
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
  const config = resolved || {
    urls: { base: '' },
    balanceKind: 'card-cycle' as const,
    authStrategyKind: 'token' as const,
  };
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
    balanceAccountIdentities: none(),
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
 * Assemble the phase slots, wiring in the resolved headless ApiMediator.
 * @param descriptor - The pipeline descriptor.
 * @returns Empty phase slots with apiMediator populated for headless banks.
 */
function buildPhaseSlots(descriptor: IPipelineDescriptor): IPhaseSlots {
  const emptySlots = emptyPhaseSlots();
  const apiMediator = resolveHeadlessApiMediator(descriptor);
  return { ...emptySlots, apiMediator };
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
  const phases = buildPhaseSlots(descriptor);
  const results: IResultSlots = emptyResultSlots();
  return { ...core, diagnostics: diag, ...phases, ...results, loginAreaReady: false };
}

export default buildInitialContext;
export { buildInitialContext };

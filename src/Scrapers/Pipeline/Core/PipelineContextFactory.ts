/**
 * Pipeline context factory — builds the initial context from descriptor.
 */

import type { ScraperCredentials } from '../../Base/Interface.js';
import { createHeadlessApiMediator } from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import { getDebug as createLogger } from '../Types/Debug.js';
import { none, some } from '../Types/Option.js';
import type { IDiagnosticsState, IPipelineContext } from '../Types/PipelineContext.js';
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

/** Pipeline-result optional slots (login, dashboard, etc.). */
interface IResultSlots {
  readonly login: IPipelineContext['login'];
  readonly dashboard: IPipelineContext['dashboard'];
  readonly scrape: IPipelineContext['scrape'];
  readonly api: IPipelineContext['api'];
  readonly preLoginDiscovery: IPipelineContext['preLoginDiscovery'];
  readonly loginFieldDiscovery: IPipelineContext['loginFieldDiscovery'];
  readonly scrapeDiscovery: IPipelineContext['scrapeDiscovery'];
}

/**
 * Build empty phase-level Option slots.
 * @returns Phase slots set to none().
 */
function emptyPhaseSlots(): IPhaseSlots {
  return { fetchStrategy: none(), mediator: none(), apiMediator: none(), browser: none() };
}

/**
 * Build empty result-level Option slots.
 * @returns Result slots set to none().
 */
function emptyResultSlots(): IResultSlots {
  return {
    login: none(),
    dashboard: none(),
    scrape: none(),
    api: none(),
    preLoginDiscovery: none(),
    loginFieldDiscovery: none(),
    scrapeDiscovery: none(),
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
  const results = emptyResultSlots();
  return { ...core, diagnostics: diag, ...phases, ...results, loginAreaReady: false };
}

/** Resolved URL string (after WK lookup). */
type ResolvedUrlStr = string;

/** Pair of URLs + optional staticAuth needed to wire the headless ApiMediator. */
interface IHeadlessWiring {
  readonly identity: ResolvedUrlStr;
  readonly graphql: ResolvedUrlStr;
  readonly staticAuth?: string;
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
  };
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
  const apiMediator = createHeadlessApiMediator({
    bankHint: descriptor.options.companyId,
    identityBaseUrl: wiring.identity,
    graphqlUrl: wiring.graphql,
    staticAuth: wiring.staticAuth,
  });
  return { ...slots, apiMediator: some(apiMediator) };
}

export default buildInitialContext;
export { buildInitialContext };

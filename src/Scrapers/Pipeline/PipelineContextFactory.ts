/**
 * Pipeline context factory — builds the initial context from descriptor.
 */

import type { ScraperCredentials } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import { getDebug as createLogger } from './Types/Debug.js';
import { none } from './Types/Option.js';
import type { IDiagnosticsState, IPipelineContext } from './Types/PipelineContext.js';

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
  const config = SCRAPER_CONFIGURATION.banks[companyId];
  return { options: descriptor.options, credentials, companyId, logger, config };
}

/** Phase-level optional slots (browser, mediator, etc.). */
interface IPhaseSlots {
  readonly fetchStrategy: IPipelineContext['fetchStrategy'];
  readonly mediator: IPipelineContext['mediator'];
  readonly browser: IPipelineContext['browser'];
}

/** Pipeline-result optional slots (login, dashboard, etc.). */
interface IResultSlots {
  readonly login: IPipelineContext['login'];
  readonly dashboard: IPipelineContext['dashboard'];
  readonly scrape: IPipelineContext['scrape'];
  readonly api: IPipelineContext['api'];
  readonly findLoginAreaDiscovery: IPipelineContext['findLoginAreaDiscovery'];
  readonly scrapeDiscovery: IPipelineContext['scrapeDiscovery'];
}

/**
 * Build empty phase-level Option slots.
 * @returns Phase slots set to none().
 */
function emptyPhaseSlots(): IPhaseSlots {
  return { fetchStrategy: none(), mediator: none(), browser: none() };
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
    findLoginAreaDiscovery: none(),
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
  const phases = emptyPhaseSlots();
  const results = emptyResultSlots();
  return { ...core, diagnostics: diag, ...phases, ...results, loginAreaReady: false };
}

export default buildInitialContext;
export { buildInitialContext };

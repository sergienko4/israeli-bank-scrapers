/**
 * Pipeline executor — reduces over phases, short-circuits on failure.
 * Each phase runs: pre → action → post → final via BasePhase.run().
 */

import { ScraperErrorTypes } from '../Base/ErrorTypes.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { runAllCleanups } from './Phases/TerminatePhase.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import type { BasePhase } from './Types/BasePhase.js';
import { getDebug } from './Types/Debug.js';
import { toErrorMessage } from './Types/ErrorUtils.js';
import type { IPipelineInterceptor } from './Types/Interceptor.js';
import { none } from './Types/Option.js';
import type { IBrowserState, IDiagnosticsState, IPipelineContext } from './Types/PipelineContext.js';
import type { Procedure } from './Types/Procedure.js';
import { fail, isOk, succeed, toLegacy } from './Types/Procedure.js';

/** Mutable state for phase reduction: tracks last context + phase list + interceptors. */
interface IContextTracker {
  readonly phases: readonly BasePhase[];
  readonly interceptors: readonly IPipelineInterceptor[];
  lastCtx: IPipelineContext;
}

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
 * @returns Core context fields: companyId, logger, config, credentials.
 */
function resolveCoreDeps(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Pick<IPipelineContext, 'options' | 'credentials' | 'companyId' | 'logger' | 'config'> {
  const companyId = descriptor.options.companyId;
  const logger = getDebug(`pipeline-${companyId}`);
  const config = SCRAPER_CONFIGURATION.banks[companyId];
  const deps = { options: descriptor.options, credentials, companyId, logger, config };
  return deps;
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
  const ctx: IPipelineContext = {
    ...core,
    diagnostics: createDiagnostics(credKeyCount),
    fetchStrategy: none(),
    mediator: none(),
    browser: none(),
    login: none(),
    dashboard: none(),
    scrape: none(),
    api: none(),
    loginAreaReady: false,
    findLoginAreaDiscovery: none(),
  };
  return ctx;
}

/**
 * Extract browser cleanup handlers from a pipeline context.
 * @param ctx - The pipeline context (may or may not have browser).
 * @returns Cleanup functions, or empty array if no browser.
 */
function extractCleanups(ctx: IPipelineContext): IBrowserState['cleanups'] {
  if (!ctx.browser.has) return [];
  return ctx.browser.value.cleanups;
}

/**
 * Run browser cleanup from the tracked context. Used in finally block.
 * @param tracker - Context tracker with the last known good context.
 * @param logger - Logger for error reporting.
 * @returns Count of successful cleanups (0 if no browser).
 */
async function ensureBrowserCleanup(
  tracker: IContextTracker,
  logger: IPipelineContext['logger'],
): Promise<number> {
  const cleanups = extractCleanups(tracker.lastCtx);
  if (cleanups.length === 0) return 0;
  logger.debug('emergency cleanup: running %d browser cleanups', cleanups.length);
  return await runAllCleanups(cleanups, logger);
}

/**
 * Run interceptors sequentially before a phase starts.
 * @param interceptors - Ordered list of interceptors.
 * @param ctx - Current pipeline context.
 * @param index - Current interceptor index.
 * @returns Updated context or first failure.
 */
async function runInterceptors(
  interceptors: readonly IPipelineInterceptor[],
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= interceptors.length) return succeed(ctx);
  const result = await interceptors[index].beforePhase(ctx);
  if (!isOk(result)) return result;
  return runInterceptors(interceptors, result.value, index + 1);
}

/**
 * Reduce phases sequentially, tracking the latest context for cleanup.
 * Runs interceptors BEFORE each phase (skips when no browser — init hasn't run yet).
 * @param tracker - Mutable tracker with phases, interceptors, and last context.
 * @param ctx - Current pipeline context.
 * @param index - Current phase index.
 * @returns Final Procedure with accumulated context.
 */
/**
 * Run interceptors if browser is available. Skip otherwise (init hasn't run yet).
 * @param tracker - Context tracker with interceptors.
 * @param ctx - Current pipeline context.
 * @returns Updated context after interceptors, or original if skipped.
 */
async function applyInterceptors(
  tracker: IContextTracker,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.browser.has) return succeed(ctx);
  if (tracker.interceptors.length === 0) return succeed(ctx);
  return runInterceptors(tracker.interceptors, ctx, 0);
}

/**
 * Reduce phases sequentially, tracking the latest context for cleanup.
 * Runs interceptors BEFORE each phase (skips when no browser — init hasn't run yet).
 * @param tracker - Mutable tracker with phases, interceptors, and last context.
 * @param ctx - Current pipeline context.
 * @param index - Current phase index.
 * @returns Final Procedure with accumulated context.
 */
async function reducePhases(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= tracker.phases.length) return succeed(ctx);
  const intercepted = await applyInterceptors(tracker, ctx);
  if (!isOk(intercepted)) return intercepted;
  tracker.lastCtx = intercepted.value;
  const result = await tracker.phases[index].run(intercepted.value);
  if (!isOk(result)) return result;
  return reducePhases(tracker, result.value, index + 1);
}

/**
 * Wrap an error into an IProcedureFailure.
 * @param error - The caught error.
 * @returns A failure Procedure with Generic error type.
 */
function wrapError(error: unknown): Procedure<IPipelineContext> {
  const message = toErrorMessage(error as Error) || 'Unknown pipeline error';
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Extract accounts array from scrape state — empty if no scrape phase ran.
 * @param ctx - The pipeline context.
 * @returns Array of transaction accounts.
 */
function extractAccounts(ctx: IPipelineContext): IScraperScrapingResult['accounts'] {
  if (!ctx.scrape.has) return [];
  return [...ctx.scrape.value.accounts];
}

/**
 * Extract scrape results from a successful pipeline context.
 * @param ctx - The final pipeline context after all phases.
 * @returns Legacy result with accounts and OTP token.
 */
function extractSuccess(ctx: IPipelineContext): IScraperScrapingResult {
  const base: IScraperScrapingResult = { success: true, accounts: extractAccounts(ctx) };
  if (ctx.login.has && ctx.login.value.persistentOtpToken.has) {
    base.persistentOtpToken = ctx.login.value.persistentOtpToken.value;
  }
  return base;
}

/**
 * Convert a pipeline result to the legacy result shape.
 * @param result - The pipeline Procedure result.
 * @returns Legacy IScraperScrapingResult.
 */
function toResult(result: Procedure<IPipelineContext>): IScraperScrapingResult {
  if (result.success) return extractSuccess(result.value);
  return toLegacy(result);
}

/**
 * Execute a pipeline descriptor against credentials.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @returns Legacy result shape for backward compatibility.
 */
async function executePipeline(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const initialCtx = buildInitialContext(descriptor, credentials);
  const tracker: IContextTracker = {
    phases: descriptor.phases,
    interceptors: descriptor.interceptors,
    lastCtx: initialCtx,
  };
  let result: Procedure<IPipelineContext>;
  try {
    result = await reducePhases(tracker, initialCtx, 0);
  } catch (error) {
    result = wrapError(error);
  } finally {
    await ensureBrowserCleanup(tracker, initialCtx.logger);
  }
  return toResult(result);
}

export default executePipeline;
export { executePipeline };

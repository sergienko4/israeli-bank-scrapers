/**
 * Pipeline executor — reduces over phases, short-circuits on failure.
 * Each phase runs: pre → action → post. Failure at any step skips the rest.
 */

import { getDebug } from '../../Common/Debug.js';
import { ScraperErrorTypes } from '../Base/ErrorTypes.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import { toErrorMessage } from './Types/ErrorUtils.js';
import { none } from './Types/Option.js';
import type { IPhaseDefinition, IPipelineStep } from './Types/Phase.js';
import type { IDiagnosticsState, IPipelineContext } from './Types/PipelineContext.js';
import type { Procedure } from './Types/Procedure.js';
import { fail, isOk, succeed, toLegacy } from './Types/Procedure.js';

/**
 * Run a single optional step if present, otherwise pass through.
 * @param step - The optional step (from phase.pre or phase.post).
 * @param ctx - Current pipeline context.
 * @param input - Input to the step.
 * @returns The step result, or succeed(input) if step is absent.
 */
async function runOptionalStep<T>(
  step: { has: true; value: IPipelineStep<T, T> } | { has: false },
  ctx: IPipelineContext,
  input: T,
): Promise<Procedure<T>> {
  if (!step.has) return succeed(input);
  return step.value.execute(ctx, input);
}

/**
 * Execute a single phase: pre → action → post.
 * @param phase - The phase definition.
 * @param ctx - Current pipeline context.
 * @returns The phase result (success with updated context, or failure).
 */
async function executePhase(
  phase: IPhaseDefinition<IPipelineContext, IPipelineContext>,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const preResult = await runOptionalStep(phase.pre, ctx, ctx);
  if (!isOk(preResult)) return preResult;
  const preCtx = preResult.value;

  const actionResult = await phase.action.execute(preCtx, preCtx);
  if (!isOk(actionResult)) return actionResult;
  const actionCtx = actionResult.value;

  return runOptionalStep(phase.post, actionCtx, actionCtx);
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
  };
  return ctx;
}

/**
 * Reduce phases sequentially using recursive Promise chain.
 * @param phases - Ordered phase definitions.
 * @param ctx - Current pipeline context.
 * @param index - Current phase index.
 * @returns Final Procedure with accumulated context.
 */
async function reducePhases(
  phases: readonly IPhaseDefinition<IPipelineContext, IPipelineContext>[],
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= phases.length) return succeed(ctx);
  const phase = phases[index];
  const result = await executePhase(phase, ctx);
  if (!isOk(result)) return result;
  return reducePhases(phases, result.value, index + 1);
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
  let result: Procedure<IPipelineContext>;
  try {
    result = await reducePhases(descriptor.phases, initialCtx, 0);
  } catch (error) {
    result = wrapError(error);
  }
  return toResult(result);
}

export default executePipeline;
export { executePipeline };

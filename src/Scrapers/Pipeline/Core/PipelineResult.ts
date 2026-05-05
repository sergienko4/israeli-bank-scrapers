/**
 * Pipeline result extraction — converts pipeline context
 * to legacy IScraperScrapingResult shape.
 */

import type { IScraperScrapingResult } from '../../Base/Interface.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { toLegacy } from '../Types/Procedure.js';

/**
 * Extract accounts array from scrape state.
 * @param ctx - The pipeline context.
 * @returns Array of transaction accounts, empty if no scrape.
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
  const base: IScraperScrapingResult = {
    success: true,
    accounts: extractAccounts(ctx),
  };
  if (ctx.login.has && ctx.login.value.persistentOtpToken.has) {
    base.persistentOtpToken = ctx.login.value.persistentOtpToken.value;
  }
  return base;
}

/**
 * Convert a pipeline Procedure result to the legacy result shape.
 * @param result - The pipeline Procedure result.
 * @returns Legacy IScraperScrapingResult.
 */
function toResult(result: Procedure<IPipelineContext>): IScraperScrapingResult {
  if (result.success) return extractSuccess(result.value);
  return toLegacy(result);
}

export default toResult;
export { toResult };

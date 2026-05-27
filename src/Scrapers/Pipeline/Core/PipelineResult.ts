/**
 * Pipeline result extraction — converts pipeline context
 * to legacy IScraperScrapingResult shape.
 *
 * v4: balance comes from BALANCE-RESOLVE.final's
 * `ctx.balanceResolution` map when present; falls back to whatever
 * SCRAPE wrote into `ctx.scrape.value.accounts[i].balance` (legacy
 * path) otherwise. This lets the v4 BALANCE-RESOLVE phase override
 * incorrect SCRAPE-time balance values for the 4 affected banks
 * (Hapoalim, Max, VisaCal, Amex) without ripping out the legacy
 * fallback that still serves the 3 working banks.
 */

import type { ITransactionsAccount } from '../../../Transactions.js';
import type { IScraperScrapingResult } from '../../Base/Interface.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { toLegacy } from '../Types/Procedure.js';

/**
 * Empty balance map sentinel — used when BALANCE-RESOLVE didn't run
 * (api-direct path, or the option is absent for any other reason).
 */
const EMPTY_BALANCE_MAP: ReadonlyMap<string, number> = new Map<string, number>();

/**
 * Read the per-account balance map committed by BALANCE-RESOLVE.final.
 * @param ctx - Pipeline context.
 * @returns Balance map (possibly empty).
 */
function readBalanceResolution(ctx: IPipelineContext): ReadonlyMap<string, number> {
  if (!ctx.balanceResolution.has) return EMPTY_BALANCE_MAP;
  return ctx.balanceResolution.value;
}

/**
 * Combine a SCRAPE-produced account with the BALANCE-RESOLVE map.
 * Map-resolved balance wins when present; otherwise the legacy
 * SCRAPE-time balance is preserved.
 * @param account - Account record produced by SCRAPE.
 * @param balanceMap - Map keyed by accountNumber.
 * @returns Account with balance populated.
 */
function combineWithBalance(
  account: ITransactionsAccount,
  balanceMap: ReadonlyMap<string, number>,
): ITransactionsAccount {
  const resolved = balanceMap.get(account.accountNumber);
  if (resolved === undefined) return account;
  return { ...account, balance: resolved };
}

/**
 * Extract accounts array from scrape state, applying BALANCE-RESOLVE
 * overrides where present.
 * @param ctx - The pipeline context.
 * @returns Array of transaction accounts, empty if no scrape.
 */
function extractAccounts(ctx: IPipelineContext): IScraperScrapingResult['accounts'] {
  if (!ctx.scrape.has) return [];
  const balanceMap = readBalanceResolution(ctx);
  return ctx.scrape.value.accounts.map(
    (acc): ITransactionsAccount => combineWithBalance(acc, balanceMap),
  );
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

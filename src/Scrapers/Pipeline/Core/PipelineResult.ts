/**
 * Pipeline result extraction — converts pipeline context
 * to the public IScraperScrapingResult shape.
 *
 * Balance comes from the `ctx.balanceResolution` map the scrape phase
 * commits; an account absent from the map keeps the balance the scrape
 * wrote into `ctx.scrape.value.accounts[i].balance`.
 */

import type { ITransactionsAccount } from '../../../Transactions.js';
import type { IScraperScrapingResult } from '../../Base/Interface.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { toLegacy } from '../Types/Procedure.js';

/**
 * Empty balance map sentinel — used when no balance map was committed.
 */
const EMPTY_BALANCE_MAP: ReadonlyMap<string, number> = new Map<string, number>();

/**
 * Read the per-account balance map committed by the scrape phase.
 * @param ctx - Pipeline context.
 * @returns Balance map (possibly empty).
 */
function readBalanceResolution(ctx: IPipelineContext): ReadonlyMap<string, number> {
  if (!ctx.balanceResolution.has) return EMPTY_BALANCE_MAP;
  return ctx.balanceResolution.value;
}

/**
 * Combine a scraped account with the balance map.
 * Map-resolved balance wins when present; otherwise the
 * scrape-time balance is preserved.
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
 * Extract accounts array from scrape state, applying balance-map
 * overrides where present.
 * @param ctx - The pipeline context.
 * @returns Array of transaction accounts, empty if no scrape.
 */
function extractAccounts(ctx: IPipelineContext): IScraperScrapingResult['accounts'] {
  if (!ctx.scrape.has) return [];
  const balanceMap = readBalanceResolution(ctx);
  return ctx.scrape.value.accounts.map((acc): ITransactionsAccount =>
    combineWithBalance(acc, balanceMap),
  );
}

/**
 * Read the durable re-login token the API-direct login chain minted.
 * Surfaced through the public `result.persistentOtpToken`.
 * @param ctx - Pipeline context.
 * @returns The token, or an empty string when the login minted none.
 */
function extractPersistentOtpToken(ctx: IPipelineContext): string {
  if (ctx.durableAuth.has) return ctx.durableAuth.value.persistentOtpToken;
  return '';
}

/**
 * Extract scrape results from a successful pipeline context.
 * @param ctx - The final pipeline context after all phases.
 * @returns Result with accounts and OTP token.
 */
function extractSuccess(ctx: IPipelineContext): IScraperScrapingResult {
  const base: IScraperScrapingResult = {
    success: true,
    accounts: extractAccounts(ctx),
  };
  const durable = extractPersistentOtpToken(ctx);
  if (durable.length > 0) base.persistentOtpToken = durable;
  return base;
}

/**
 * Convert a pipeline Procedure result to the public result shape.
 * @param result - The pipeline Procedure result.
 * @returns IScraperScrapingResult.
 */
function toResult(result: Procedure<IPipelineContext>): IScraperScrapingResult {
  if (result.success) return extractSuccess(result.value);
  return toLegacy(result);
}

export default toResult;
export { toResult };

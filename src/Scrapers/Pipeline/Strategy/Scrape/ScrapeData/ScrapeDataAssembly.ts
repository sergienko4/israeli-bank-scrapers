/**
 * Scrape account-assembly helpers — final accountNumber resolution +
 * SCRAPE-side account result build. Drained from
 * `ScrapeDataActions.ts` during the Phase 12e file-size split;
 * `buildAccountResult` is re-exported verbatim from the barrel facade.
 *
 * v4 (2026-05-27): balance lookup is owned exclusively by the
 * BALANCE-RESOLVE phase. SCRAPE here writes only `accountNumber` and
 * `txns` on the assembled account.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import type { Brand } from '../../../Types/Brand.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { resolveDisplayIdFromCapturedEndpoints } from '../Account/ScrapeIdExtraction.js';
import type { IAccountAssemblyCtx } from '../ScrapeTypes.js';

/** Resolved final account-number string. */
type AccountNumberStr = Brand<string, 'AccountNumberStr'>;

/** Fallback accountNumber value when no record carries a display ID. */
const DEFAULT_ACCOUNT_NUMBER = 'default';

/**
 * Resolve final accountNumber. Prefers ctx ids; if both are empty or
 * the synthetic 'default' placeholder, scan captured endpoints.
 * Generic — no bank-specific routing.
 * @param ctx - Assembly context.
 * @returns Best-effort accountNumber string (never empty).
 */
function resolveAccountNumber(ctx: IAccountAssemblyCtx): AccountNumberStr {
  const primary = ctx.displayId || ctx.accountId;
  if (primary && primary !== DEFAULT_ACCOUNT_NUMBER) return primary as AccountNumberStr;
  const fromStore = resolveDisplayIdFromCapturedEndpoints(ctx.fc.network);
  if (isOk(fromStore)) return fromStore.value as AccountNumberStr;
  return (primary || DEFAULT_ACCOUNT_NUMBER) as AccountNumberStr;
}

/**
 * Build SCRAPE-side account result.
 *
 * <p>v4 (2026-05-27): balance is NO LONGER set here. The BALANCE-
 * RESOLVE phase owns balance resolution and writes
 * `ctx.balanceResolution`; `PipelineResult.combineWithBalance` merges
 * it onto the account by `accountNumber`. SCRAPE writes only the
 * `accountNumber` and `txns` fields. Keeping `balance` undefined on
 * the SCRAPE output is intentional — the type allows it (optional)
 * and the merge step never reads it.
 *
 * @param ctx - Assembly context.
 * @param txns - Transactions.
 * @returns Assembled account Procedure.
 */
function buildAccountResult(
  ctx: IAccountAssemblyCtx,
  txns: readonly ITransaction[],
): Procedure<ITransactionsAccount> {
  const accountNumber = resolveAccountNumber(ctx);
  return succeed({ accountNumber, txns: [...txns] });
}

export default buildAccountResult;

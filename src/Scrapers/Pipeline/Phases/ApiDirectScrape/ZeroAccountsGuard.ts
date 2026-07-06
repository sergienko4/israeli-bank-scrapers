/**
 * Default fail-closed scrape guard for the hard-model ApiDirectScrape phase —
 * a pure predicate consumed by the POST stage via {@link runResultGuard}.
 *
 * <p>Why this exists: a hard-model bank resolves its accounts from the first
 * post-login data call. When that call is rejected — an HTTP non-200 (a dead
 * session, e.g. Max's 403) or an HTTP-200 bank error envelope (e.g. Yahav's
 * BaNCS 93194) — the extractor finds no account, so the driver iterates zero
 * accounts, fetches no transactions, and the run completes as a SILENT
 * `success([])`: zero transactions, no error. This guard converts that exact
 * shape into a LOUD, typed failure so an invalid session surfaces instead of
 * looking like an empty account.
 *
 * <p>`accountCount === 0` is a universally invalid post-login outcome: a
 * logged-in customer always owns at least one account/card. It is therefore
 * the phase-wide default (applied when a shape declares no `resultGuard`);
 * a shape with its own guard (PayBox's degraded-token guard) keeps it.
 * PII-safe: the message carries no identifiers.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IApiDirectScrapeGuardSummary } from './IApiDirectScrapeShape.js';

/**
 * PII-free operator message: the diagnosis (zero accounts ⇒ invalid session)
 * and the remedy (re-authenticate). No identifiers, no figures.
 */
const ZERO_ACCOUNTS_MSG =
  'Hard-model scrape resolved zero accounts — the post-login session is invalid ' +
  'or the accounts response was rejected (a bank error envelope or a non-200). ' +
  'Re-authenticate; a logged-in customer always has at least one account.';

/**
 * Fail-closed guard: rejects a scrape that resolved no accounts.
 * @param summary - PII-free scrape summary from the POST stage.
 * @returns Failure when zero accounts were resolved; otherwise a pass-through.
 */
export function zeroAccountsGuard(summary: IApiDirectScrapeGuardSummary): Procedure<void> {
  if (summary.accountCount === 0) return fail(ScraperErrorTypes.Generic, ZERO_ACCOUNTS_MSG);
  return succeed(undefined);
}

export default zeroAccountsGuard;

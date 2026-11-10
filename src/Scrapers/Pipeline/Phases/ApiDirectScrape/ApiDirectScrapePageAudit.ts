/**
 * Page-coverage guardrails for the ApiDirectScrape transactions walk.
 *
 * <p>Two audits answer the same question from opposite ends: one re-reads the
 * response body to find rows the shape never returned, the other checks the
 * count the provider itself declared. Neither repairs anything — each reports
 * to the account's evidence ledger and the page passes through untouched.
 * Split out of ApiDirectScrapeSteps.ts to keep both files under the per-file
 * LOC ceiling.
 *
 * <p>The hunt runs on every page of every bank because the defect it catches is
 * a provider-side change — a container added or renamed upstream — which no
 * amount of care in our own code prevents.
 */

import type {
  ICoverageArgs,
  ICoverageResult,
  OwnsRow,
} from '../../Mediator/Scrape/CoverageAudit/CoverageAudit.js';
import {
  auditCoverage,
  OWNS_EVERY_ROW,
} from '../../Mediator/Scrape/CoverageAudit/CoverageAudit.js';
import { auditDeclaredRows } from '../../Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import type { IAcctCtx } from './ApiDirectScrapeTypes.js';
import type { ApiBody } from './IApiDirectScrapeShape.js';

/**
 * Bind a shape's declared row-ownership test to the account being audited.
 *
 * Only a shape whose response carries every account merged declares one. For
 * the rest the audit's own default applies, and returning it here rather than
 * nothing keeps a single definition of what "this row is mine" means.
 *
 * @param a - Per-account context.
 * @returns The bound test, or the every-row default when none is declared.
 */
function ownsRowFor<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): OwnsRow {
  const declared = a.shape.transactions.auditOwnsRow;
  if (!declared) return OWNS_EVERY_ROW;
  return (row: object): boolean => declared(row, a.acct);
}

/**
 * Reconcile one page: compare the rows the bank shape returned against every
 * transaction discoverable in the same response body.
 *
 * <p>A shape whose response carries every account merged declares
 * `auditOwnsRow`; bound to this account by {@link ownsRowFor} it narrows hunted
 * rows to the ones this account owns. Without it the other accounts' rows would
 * read as loss on every page. Banks with a per-account response declare
 * nothing. Likewise a shape whose table carries a readable non-transaction row
 * declares `auditIsTxnRow`, so that row is never counted as loss.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @param items - Rows the shape extracted from that body.
 * @returns Coverage counts for the page.
 */
function auditPageCoverage<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  items: readonly object[],
): ICoverageResult {
  const result = huntPage(a, body, items);
  a.ledger.noteWhen('extractionShortfall', result.unread > 0);
  a.ledger.noteWhen('extractionAuditUnavailable', result.unaudited);
  return result;
}

/**
 * Hunt the body for rows the shape never returned.
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @param items - Rows the shape extracted from that body.
 * @returns Coverage counts for the page.
 */
function huntPage<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  items: readonly object[],
): ICoverageResult {
  const probe = coverageProbe(a);
  return auditCoverage({ body, extracted: items, ...probe });
}

/**
 * The shape facts a page audit needs to tell its rows from the bank's.
 * @param a - Per-account context.
 * @returns Everything {@link auditCoverage} needs but the page itself.
 */
function coverageProbe<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Omit<ICoverageArgs, 'body' | 'extracted'> {
  const label = `${a.ctx.companyId}/txns`;
  const isCardIssuer = a.shape.isCardIssuer;
  const ownsRow = ownsRowFor(a);
  const isTxnRow = a.shape.transactions.auditIsTxnRow;
  return { label, isCardIssuer, ownsRow, isTxnRow };
}

/**
 * Reconcile one page against the counts the provider itself declared.
 *
 * Complements {@link auditPageCoverage}: that audit hunts the body and can be
 * argued with, this one quotes the provider back at itself and cannot. Runs
 * only for banks whose response carries such a count.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @returns True once the check has reported.
 */
function auditPageDeclared<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, body: ApiBody): true {
  const specs = a.shape.transactions.declaredRowSpecs ?? [];
  const label = `${a.ctx.companyId}/txns`;
  const result = auditDeclaredRows({ body, specs, label });
  a.ledger.noteWhen('declaredRowShortfall', result.shortfall > 0);
  a.ledger.noteWhen('declaredRowAuditUnavailable', result.unavailable);
  return true;
}

/**
 * Run both guardrails over one fetched page.
 *
 * Kept together because they answer the same question from opposite ends —
 * one re-reads the body to find rows the shape never returned, the other
 * checks the count the provider itself declared. Neither repairs anything.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @param items - Rows the shape extracted from it.
 * @returns True once both checks have reported.
 */
export function auditPage<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  items: readonly object[],
): true {
  auditPageCoverage(a, body, items);
  return auditPageDeclared(a, body);
}

export default auditPage;

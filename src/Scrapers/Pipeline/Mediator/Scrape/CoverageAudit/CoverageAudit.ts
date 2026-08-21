/**
 * Coverage reconciliation — a guardrail that answers the one question the
 * pipeline could never answer about itself: *did the extractor read every
 * transaction the response actually carried?*
 *
 * A bank shape names the containers it reads. When a provider adds a fourth
 * container, or renames one, the shape keeps returning rows and the run keeps
 * succeeding — it simply returns fewer. That failure is silent by
 * construction: totals are lower, no field is malformed, and nothing throws.
 * Two banks shipped in exactly that state (Isracard and Amex, each losing
 * ~41% of a real statement while logging nothing above debug).
 *
 * This module re-reads the same response body with {@link huntTransactions},
 * the schema-agnostic hunter already running in production for Yahav, and
 * reports what the shape did not return. It only ever WARNS — see
 * {@link auditCoverage} for why it must never repair.
 */

import type { ITransaction } from '../../../../../Transactions.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import huntTransactions from '../FieldHunt/TxnHunt.js';
import { autoMapTransaction } from '../TxnMapper/TxnMapper.js';

const LOG = getDebug(import.meta.url);

/** Outcome of one reconciliation round. Counts only — never row content. */
export interface ICoverageResult {
  /** Distinct transactions the bank shape returned. */
  readonly extracted: number;
  /** Distinct transactions discoverable anywhere in the response body. */
  readonly hunted: number;
  /** Hunted transactions the shape did not return. Above zero means loss. */
  readonly unread: number;
}

/** Inputs for one reconciliation round. */
export interface ICoverageArgs {
  /** Raw response body, exactly as received. */
  readonly body: object;
  /** Rows the bank shape extracted from that body. */
  readonly extracted: readonly object[];
  /** Whether the institution is a card issuer, so charge signs match. */
  readonly isCardIssuer?: boolean;
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/**
 * Reduce a raw row to the identity the consumer ultimately sees.
 *
 * Comparing object references instead would report a false loss for every
 * transforming extractor — Yahav's BaNCS normaliser returns new objects, so
 * not one of its rows is reference-equal to the row it came from. Comparing
 * mapped output compares what actually reaches the caller.
 *
 * @param raw - Raw row from the response body.
 * @param isCardIssuer - Card-issuer hint forwarded to the mapper.
 * @returns Stable key, or false when the row is not a transaction.
 */
function mappedKey(raw: ApiRecord, isCardIssuer?: boolean): string | false {
  const txn: ITransaction | false = autoMapTransaction(raw, isCardIssuer);
  if (txn === false) return false;
  return `${txn.date}|${String(txn.chargedAmount)}|${txn.description}`;
}

/**
 * Map rows to their distinct mapped keys, dropping the unmappable.
 *
 * The hunter deliberately over-collects — it scores arrays heuristically and
 * will happily return schema descriptors or summary blocks. A row the mapper
 * rejects is not a transaction, so it can never be a lost one; dropping it
 * here is what keeps the guardrail quiet on healthy banks.
 *
 * @param rows - Raw rows to reduce.
 * @param isCardIssuer - Card-issuer hint forwarded to the mapper.
 * @returns Distinct mapped keys.
 */
function keysOf(rows: readonly object[], isCardIssuer?: boolean): ReadonlySet<string> {
  const candidates = rows.map((row): string | false => mappedKey(row as ApiRecord, isCardIssuer));
  const mappable = candidates.filter((key): key is string => key !== false);
  return new Set(mappable);
}

/**
 * Build the one-line coverage verdict.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns Log message carrying counts only.
 */
function coverageMessage(label: string, result: ICoverageResult): string {
  const detail = `extracted=${String(result.extracted)} hunted=${String(result.hunted)}`;
  if (result.unread === 0) return `coverage ${label}: complete (${detail})`;
  return `coverage ${label}: INCOMPLETE — unread=${String(result.unread)} (${detail})`;
}

/**
 * Emit the coverage verdict. Counts and the caller-supplied label only — row
 * content never reaches the log, per logging-pii-guidlines.md.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns The same counts, so callers can report and return in one step.
 */
function reportCoverage(label: string, result: ICoverageResult): ICoverageResult {
  const message = coverageMessage(label, result);
  const isComplete = result.unread === 0;
  if (isComplete) LOG.debug({ message });
  else LOG.warn({ message });
  return result;
}

/**
 * Compare what a bank shape returned against what its response carried.
 *
 * Reports only; it never appends the missing rows. Hunted rows are found by
 * heuristic, so their provenance and field semantics are unverified —
 * injecting them into user data would trade a visible shortfall for invisible
 * corruption. The correct repair is always to teach the bank shape the
 * container it is missing, which is a reviewed code change.
 *
 * @param args - Response body, extracted rows, and log identity.
 * @returns Counts for the round.
 */
export function auditCoverage(args: ICoverageArgs): ICoverageResult {
  const extracted = keysOf(args.extracted, args.isCardIssuer);
  const huntedRows = huntTransactions(args.body as ApiRecord);
  const hunted = keysOf(huntedRows, args.isCardIssuer);
  const missing = [...hunted].filter(key => !extracted.has(key));
  const result = { extracted: extracted.size, hunted: hunted.size, unread: missing.length };
  return reportCoverage(args.label, result);
}

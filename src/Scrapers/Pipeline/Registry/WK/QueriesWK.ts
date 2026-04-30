/**
 * WK queries registry — GraphQL query strings keyed by (operation, bankHint).
 * Banks populate via `registerWkQuery` at module-load time.
 * Zero bank-name literals in this file (one-way: WK depends on bank data, not code).
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Supported WK query operations — generic API verbs. */
export type WKQueryOperation = 'customer' | 'transactions' | 'balance';

/** Return value of registerWkQuery — signals the entry was stored. */
type WasQueryRegistered = boolean;

/** Internal registry: op -> bankHint -> query string. */
const WK_QUERIES = new Map<WKQueryOperation, Map<CompanyTypes, string>>();

/**
 * Lookup or create the inner bank map for a query operation.
 * @param operation - WK query operation.
 * @returns Inner map.
 */
function bankMapFor(operation: WKQueryOperation): Map<CompanyTypes, string> {
  const existing = WK_QUERIES.get(operation);
  if (existing) return existing;
  const created = new Map<CompanyTypes, string>();
  WK_QUERIES.set(operation, created);
  return created;
}

/**
 * Register a GraphQL query string for a (operation, bankHint) pair.
 * Called by bank-local data files at module-load time.
 * @param operation - WK query operation.
 * @param bankHint - Target bank identifier.
 * @param query - GraphQL query string.
 * @returns True once stored.
 */
export function registerWkQuery(
  operation: WKQueryOperation,
  bankHint: CompanyTypes,
  query: string,
): WasQueryRegistered {
  const inner = bankMapFor(operation);
  inner.set(bankHint, query);
  return true;
}

/**
 * Resolve a GraphQL query string for (operation, bankHint).
 * @param operation - WK query operation.
 * @param bankHint - Target bank identifier.
 * @returns Procedure carrying the query string, or fail if unknown.
 */
export function resolveWkQuery(
  operation: WKQueryOperation,
  bankHint: CompanyTypes,
): Procedure<string> {
  const inner = WK_QUERIES.get(operation);
  const hit = inner?.get(bankHint);
  if (!hit) return fail(ScraperErrorTypes.Generic, `unknown WK query: ${operation}/${bankHint}`);
  return succeed(hit);
}

export { WK_QUERIES };

/**
 * WK queries registry — GraphQL query strings keyed by (operation, bankHint).
 * Seeded via `registerWkQuery` at module-load time, then frozen on first `resolveWkQuery`.
 * Zero bank-name literals in this file (one-way: WK depends on bank data, not code).
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Supported WK query operations — generic API verbs. */
export type WKQueryOperation = 'customer' | 'transactions' | 'balance';

/** Internal registry: op -> bankHint -> query string. */
const WK_QUERIES = new Map<WKQueryOperation, Map<CompanyTypes, string>>();

/** Set on first `resolveWkQuery` read; blocks all subsequent `registerWkQuery` writes. */
let isFrozen = false;

/**
 * Mark the query registry frozen on first read so subsequent registrations fail closed.
 * @returns True once frozen.
 */
function ensureFrozen(): true {
  isFrozen = true;
  return true;
}

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
 * Fail closed when a caller attempts to register a query after the first resolve.
 * @param operation - WK query operation.
 * @param bankHint - Target bank identifier.
 * @returns True when the registry is still writable.
 */
function assertWritable(operation: WKQueryOperation, bankHint: CompanyTypes): true {
  if (isFrozen) {
    throw new ScraperError(`WK query registry is frozen; refused ${operation}/${bankHint}`);
  }
  return true;
}

/**
 * Register a GraphQL query string for an `(operation, bankHint)` pair during module-load seeding.
 * Fails closed with {@link ScraperError} once {@link resolveWkQuery} has frozen the registry.
 * @internal
 * @param operation - WK query operation.
 * @param bankHint - Target bank identifier.
 * @param query - GraphQL query string.
 * @returns True once stored.
 */
export function registerWkQuery(
  operation: WKQueryOperation,
  bankHint: CompanyTypes,
  query: string,
): true {
  assertWritable(operation, bankHint);
  const inner = bankMapFor(operation);
  inner.set(bankHint, query);
  return true;
}

/**
 * Resolve a GraphQL query string for `(operation, bankHint)`, freezing the registry on first read.
 * @param operation - WK query operation.
 * @param bankHint - Target bank identifier.
 * @returns Procedure carrying the query string, or fail if unknown.
 */
export function resolveWkQuery(
  operation: WKQueryOperation,
  bankHint: CompanyTypes,
): Procedure<string> {
  ensureFrozen();
  const inner = WK_QUERIES.get(operation);
  const hit = inner?.get(bankHint);
  if (!hit) return fail(ScraperErrorTypes.Generic, `unknown WK query: ${operation}/${bankHint}`);
  return succeed(hit);
}

/**
 * Clear all registered queries and lift the freeze flag for isolated unit tests.
 * @internal
 * @returns True after reset.
 */
export function resetWkRegistryForTest(): true {
  WK_QUERIES.clear();
  isFrozen = false;
  return true;
}

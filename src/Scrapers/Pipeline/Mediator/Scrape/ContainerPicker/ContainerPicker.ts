/**
 * Container picker — extracts transactions from API responses with
 * an optional card-aware 3-step resolution chain. Owns the
 * `extractTransactions` workhorse plus the
 * `extractTransactionsForCard` STRICT_SCOPE anti-mirroring chain
 * (Index{cardId} subtree → cardIndex value BFS → empty).
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import type { ITransaction } from '../../../../../Transactions.js';
import { getDebug } from '../../../Types/Debug.js';
import { unwrapWcfEnvelope } from '../../Network/Indexing/ResponseEnvelope.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { isSearchableObject } from '../BfsFieldSearch/BfsFieldSearch.js';
import huntTransactions from '../FieldHunt/TxnHunt.js';
import { autoMapTransaction, isVoidedTransaction } from '../TxnMapper/TxnMapper.js';

const LOG = getDebug(import.meta.url);

/**
 * Build the structured debug summary fired after
 * {@link extractTransactions} maps the hunt output. Pulled out so
 * the orchestrator stays a thin filter+map pipeline.
 *
 * @param totalFound - Total hunt-collected records.
 * @param validCount - Records passing the voided filter.
 * @param keptCount - Records successfully mapped to ITransaction.
 * @returns Diagnostic line ready for `LOG.debug`.
 */
function buildHuntSummary(totalFound: number, validCount: number, keptCount: number): string {
  return (
    `huntTransactions: ${String(totalFound)} found, ` +
    `${String(validCount)} valid, ${String(keptCount)} mapped`
  );
}

/**
 * Extract transactions from an API response using stack-based
 * iterative hunt. Filters voided/summary rows. Maps to ITransaction.
 *
 * <p>Unwraps the WCF `Broker.svc` envelope first
 * ({@link unwrapWcfEnvelope}) so fresh per-account fetches — which
 * `fetchPost` returns verbatim as `{ ProcessRequestResult, jsonResp }`
 * without the {@link "../../Network/Indexing/ResponseParser.js"}
 * capture-time unwrap — descend into the real container. Idempotent +
 * default-deny: already-unwrapped / non-envelope bodies pass through
 * unchanged, so every other bank is unaffected.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of mapped ITransactions.
 */
function extractTransactions(responseBody: ApiRecord): readonly ITransaction[] {
  const inner = unwrapWcfEnvelope(responseBody) as ApiRecord;
  const items = huntTransactions(inner);
  const valid = items.filter((r): boolean => !isVoidedTransaction(r));
  const mapped = valid.map(autoMapTransaction);
  const kept = mapped.filter((t): t is ITransaction => t !== false);
  const message = buildHuntSummary(items.length, valid.length, kept.length);
  LOG.debug({ message });
  return kept;
}

/**
 * Step 1: Key-based lookup — find `Index{cardId}` subtree in
 * response. Isracard/Amex pattern:
 * `CardsTransactionsListBean.Index0`, `.Index1`, etc.
 * @param body - API response body.
 * @param cardId - Card index (e.g. '0', '1', '5').
 * @returns Subtree record if found, false otherwise.
 */
function findIndexedSubtree(body: ApiRecord, cardId: string): ApiRecord | false {
  const indexKey = `Index${cardId}`;
  const values = Object.values(body);
  const nested = values.filter((v): boolean => isSearchableObject(v));
  const records = nested.map((v): ApiRecord => v as ApiRecord);
  const match = records.find((rec): boolean => indexKey in rec);
  if (match) return match[indexKey] as ApiRecord;
  return false;
}

/**
 * Step 2: Value-based BFS — filter transaction items by cardIndex
 * field.
 *
 * Routes through `huntTransactions` + `isVoidedTransaction` so this
 * fallback uses the SAME txn-signature filter + voided-row guard as
 * the primary `extractTransactions` path. Previously walked the
 * first array via `findFirstArray` and skipped the voided filter,
 * which could either return zero items when the first array was not
 * the txn array, OR let voided rows through when it was — CodeRabbit
 * PR #277 review caught both behaviour gaps.
 * @param body - API response body.
 * @param cardId - Card index to match.
 * @returns Filtered transaction items, empty if none matched.
 */
function filterByCardIndex(body: ApiRecord, cardId: string): readonly ITransaction[] {
  const matched = huntTransactions(body).filter(
    (item): boolean => !isVoidedTransaction(item) && String(item.cardIndex) === cardId,
  );
  if (matched.length === 0) return [];
  const mapped = matched.map(autoMapTransaction);
  return mapped.filter((t): t is ITransaction => t !== false);
}

/**
 * Apply the cardIndex value-BFS extraction step and emit the matching
 * debug log. Pulled out so {@link extractTransactionsForCard} stays
 * within the per-function LoC budget.
 *
 * @param body - API response body.
 * @param cardId - Card index for scoping.
 * @returns Filtered transaction items (empty when no match).
 */
function extractByValueBfs(body: ApiRecord, cardId: string): readonly ITransaction[] {
  const byValue = filterByCardIndex(body, cardId);
  if (byValue.length === 0) return [];
  const count = String(byValue.length);
  LOG.debug({ message: `extractForCard: cardIndex=${cardId} → value BFS (${count} txns)` });
  return byValue;
}

/**
 * Apply the indexed-subtree key-lookup step. Emits the matching
 * debug log when a subtree is found and delegates the extraction to
 * {@link extractTransactions}; returns `false` so the orchestrator
 * can fall through to the next chain step.
 *
 * @param body - API response body.
 * @param cardId - Card index for scoping.
 * @returns Extracted transactions, or `false` on miss.
 */
function extractByIndexedSubtree(body: ApiRecord, cardId: string): readonly ITransaction[] | false {
  const subtree = findIndexedSubtree(body, cardId);
  if (!subtree) return false;
  LOG.debug({ message: `extractForCard: Index${cardId} → key lookup` });
  return extractTransactions(subtree);
}

/**
 * Card-aware extraction — 3-step resolution chain.
 * 1. Key lookup: `Index{cardId}` subtree (Isracard/Amex)
 * 2. Value BFS: filter by `cardIndex` field value
 * 3. STRICT_SCOPE: empty (no fallback — prevents cross-card
 *    mirroring that would attribute every card's txns to every
 *    other card in the same statement window).
 * @param body - API response body.
 * @param cardId - Card index for scoping.
 * @returns Transactions for the specified card only.
 */
function extractTransactionsForCard(body: ApiRecord, cardId: string): readonly ITransaction[] {
  const byKey = extractByIndexedSubtree(body, cardId);
  if (byKey !== false) return byKey;
  const byValue = extractByValueBfs(body, cardId);
  if (byValue.length > 0) return byValue;
  const message = `STRICT_SCOPE: no data for Card ${cardId} — returning empty (no fallback)`;
  LOG.warn({ message });
  return [];
}

export { extractTransactions, extractTransactionsForCard };

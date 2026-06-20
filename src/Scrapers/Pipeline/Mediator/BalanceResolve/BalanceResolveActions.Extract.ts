/**
 * BalanceResolveActions.Extract — per-card record finder + balance
 * extraction. Extracted from the BalanceResolveActions barrel so the
 * per-file LoC cap is honoured (phase-2e-residue split).
 */

import { PIPELINE_DISPLAY_ID_FIELDS } from '../../Registry/WK/BalanceResolveWK.js';
import type {
  BalanceExtractionOutcome,
  IAccountIdentity,
  IBalanceExtracted,
} from '../../Types/PipelineContext.js';
import { runBalanceExtractor } from './BalanceExtractor.js';
import { BULK_KEY } from './BalanceFetchPlanner.js';

/** Sentinel returned by findCardRecord when no match is present. */
const NO_CARD_RECORD: Record<string, unknown> = Object.freeze({});

/**
 * Identify the no-match sentinel.
 * @param rec - Candidate card record.
 * @returns True when this record is the NO_CARD_RECORD sentinel.
 */
function isNoCardRecord(rec: Record<string, unknown>): boolean {
  return rec === NO_CARD_RECORD;
}

/**
 * Match a single display-id field value against the identity's cardDisplayId.
 * @param value - Value picked from a record's display-id field.
 * @param target - Identity's cardDisplayId.
 * @returns True when value matches.
 */
function matchDisplayField(value: unknown, target: string): boolean {
  if (typeof value === 'string') return value === target;
  if (typeof value === 'number') return String(value) === target;
  return false;
}

/**
 * Does the record's cardUniqueId / display fields match the identity?
 * @param rec - JSON record.
 * @param identity - Identity to match.
 * @returns True when this record represents this card.
 */
function matchesIdentity(rec: Record<string, unknown>, identity: IAccountIdentity): boolean {
  const uid = rec.cardUniqueId ?? rec.cardUniqueID;
  if (typeof uid === 'string' && uid === identity.cardUniqueId) return true;
  return PIPELINE_DISPLAY_ID_FIELDS.some((f): boolean =>
    matchDisplayField(rec[f], identity.cardDisplayId),
  );
}

/**
 * Walk an array looking for a card record that matches the identity.
 * @param arr - Array of JSON values.
 * @param identity - Card identity to match.
 * @returns Matching card record, or {@link NO_CARD_RECORD}.
 */
function findCardRecordInArray(
  arr: readonly unknown[],
  identity: IAccountIdentity,
): Record<string, unknown> {
  const candidates = arr.map((item): Record<string, unknown> => findCardRecord(item, identity));
  return candidates.find((c): boolean => !isNoCardRecord(c)) ?? NO_CARD_RECORD;
}

/**
 * Recurse into a record's children looking for a card record match.
 * @param rec - Record to recurse into.
 * @param identity - Card identity to match.
 * @returns Matching descendant card record, or {@link NO_CARD_RECORD}.
 */
function findCardRecordInChildren(
  rec: Record<string, unknown>,
  identity: IAccountIdentity,
): Record<string, unknown> {
  const values = Object.values(rec);
  const candidates = values.map((v): Record<string, unknown> => findCardRecord(v, identity));
  return candidates.find((c): boolean => !isNoCardRecord(c)) ?? NO_CARD_RECORD;
}

/**
 * Find a per-card record nested inside a bank-account-level response.
 * @param node - JSON sub-tree.
 * @param identity - Card identity to match.
 * @returns Card record, or {@link NO_CARD_RECORD} when not found.
 */
function findCardRecord(node: unknown, identity: IAccountIdentity): Record<string, unknown> {
  if (Array.isArray(node)) return findCardRecordInArray(node, identity);
  if (node === null || typeof node !== 'object') return NO_CARD_RECORD;
  const rec = node as Record<string, unknown>;
  if (matchesIdentity(rec, identity)) return rec;
  return findCardRecordInChildren(rec, identity);
}

/**
 * Extract per-card balance from a bank-account-level response.
 * @param body - Response body for the card's bank account.
 * @param identity - Card identity (cardUniqueId + cardDisplayId).
 * @returns Finite balance number, or `false` for MISS.
 */
function extractPerCardBalance(body: unknown, identity: IAccountIdentity): number | false {
  const card = findCardRecord(body, identity);
  const fromCard = isNoCardRecord(card) ? false : runBalanceExtractor(card);
  if (fromCard !== false) return fromCard;
  return runBalanceExtractor(body);
}

/**
 * Extract a card's balance from one response body (undefined-safe).
 * @param body - Candidate response body (keyed or bulk), may be undefined.
 * @param identity - Card identity.
 * @returns Finite balance, or `false` when absent / carries no balance.
 */
function extractFromBody(body: unknown, identity: IAccountIdentity): number | false {
  if (body === undefined) return false;
  return extractPerCardBalance(body, identity);
}

/**
 * Choose the keyed-response balance, else the captured BULK_KEY balance.
 * @param keyed - Balance from the card's own keyed response, or false.
 * @param bulk - Balance from the captured BULK_KEY body, or false.
 * @returns The first finite balance, else 'MISS'.
 */
function pickKeyedOrBulk(keyed: number | false, bulk: number | false): BalanceExtractionOutcome {
  if (keyed !== false) return keyed;
  return bulk === false ? 'MISS' : bulk;
}

/**
 * Extract one card's balance: prefer its own keyed response, then fall
 * back to the captured BULK_KEY body when the keyed response is absent
 * OR carries no balance — e.g. a wrong-endpoint live fetch that 200s
 * without a balance must not shadow the captured pool's real balance.
 * @param identity - Card identity.
 * @param responses - Responses keyed by bankAccountUniqueId.
 * @returns Outcome.
 */
function extractOneCard(
  identity: IAccountIdentity,
  responses: ReadonlyMap<string, unknown>,
): BalanceExtractionOutcome {
  const keyedBody = responses.get(identity.bankAccountUniqueId);
  const bulkBody = responses.get(BULK_KEY);
  const fromKeyed = extractFromBody(keyedBody, identity);
  const fromBulk = extractFromBody(bulkBody, identity);
  return pickKeyedOrBulk(fromKeyed, fromBulk);
}

/** Bundled args for {@link extractAllCards}. */
interface IExtractAllArgs {
  readonly identities: ReadonlyMap<string, IAccountIdentity>;
  readonly responses: ReadonlyMap<string, unknown>;
}

/**
 * Iterate every card identity, running the per-card extractor.
 * @param args - Bundled identities + responses.
 * @returns Per-card outcomes (number or 'MISS').
 */
function extractAllCards(args: IExtractAllArgs): IBalanceExtracted {
  const { identities, responses } = args;
  const out = new Map<string, BalanceExtractionOutcome>();
  for (const identity of identities.values()) {
    const outcome = extractOneCard(identity, responses);
    out.set(identity.cardDisplayId, outcome);
  }
  return out;
}

export type { IExtractAllArgs };
export { extractAllCards };

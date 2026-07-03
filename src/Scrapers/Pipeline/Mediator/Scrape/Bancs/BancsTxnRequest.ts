/**
 * BaNCS transaction-request recognition — identifies a captured
 * `/account` POST whose REQUEST BODY is a CURRENT_ACCOUNT date-range
 * transactions query (TCS BaNCS Digital).
 *
 * <p>BaNCS multiplexes account-details, transactions, balance and
 * portfolio through the SAME `POST …/BaNCSDigitalApp/account` URL,
 * differentiated only by the request BODY (`Payload.Category` + a
 * date-range `Filters` tree). The URL-based txn picker
 * ({@link "../../Network/Scoring/ShapeAware.js"} `filterPoolMatches`)
 * and the DASHBOARD FINAL gate therefore never match it. This module is
 * the default-deny body-shape guard that lets exactly the CURRENT_ACCOUNT
 * txn capture — and nothing else — satisfy both.
 *
 * <p>Discriminator (verified from the live trace, PII-safe): the request
 * body carries `Payload.Category` including `CURRENT_ACCOUNT` AND a
 * `Payload.Filters[].Filters[].OrigDt {Day,Month,Year}` numeric calendar
 * date. The `portfolioBalance` request (`Category=['portfolioBalance']`,
 * no Filters) and the account-details request (no Category) both fail.
 *
 * <p>Default-deny: {@link isBancsTxnCapture} returns `false` for every
 * non-BaNCS capture (bad/empty JSON, non-`/account` URL, wrong Category,
 * missing date range), so the picker + gate keep their exact URL-only
 * behaviour for the other pipeline banks (Leumi/Discount/VisaCal/Max/
 * Isracard). No Network/Dashboard import — a pure leaf keyed by shape.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isNum } from './BancsShape.js';

/** Minimal capture surface the guard reads — url + request body. */
interface IBancsCapture {
  readonly url: string;
  readonly postData: string;
}

/** BaNCS resource path shared by every account-multiplexed call. */
const ACCOUNT_PATH_FRAGMENT = '/account';

/** Category discriminator marking a current-account txn query. */
const CURRENT_ACCOUNT_CATEGORY = 'CURRENT_ACCOUNT';

/** Numeric parts a BaNCS `OrigDt` calendar-date bound must carry. */
const ORIG_DT_PARTS = ['Day', 'Month', 'Year'] as const;

/**
 * Plain-object type guard over an unknown JSON value.
 * @param v - Value to test.
 * @returns True when `v` is a non-null, non-array object.
 */
function isRec(v: unknown): v is ApiRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Whether a filter node carries a numeric `OrigDt {Day,Month,Year}`.
 * @param node - Candidate inner-filter record.
 * @returns True when the node holds a BaNCS date-range bound.
 */
function hasOrigDtRange(node: ApiRecord): boolean {
  const parts = ORIG_DT_PARTS.map((k): unknown => getIn(node, ['OrigDt', k]));
  return parts.every(isNum);
}

/**
 * Peel the inner `Filters[]` records from one outer filter node.
 * @param outerNode - One `Payload.Filters[]` element.
 * @returns Inner filter records, or empty when the shape is absent.
 */
function peelInner(outerNode: unknown): readonly ApiRecord[] {
  if (!isRec(outerNode)) return [];
  const inner = outerNode.Filters;
  if (!Array.isArray(inner)) return [];
  return (inner as readonly unknown[]).filter(isRec);
}

/**
 * Flatten every `Payload.Filters[].Filters[]` inner filter record.
 * @param body - Parsed request body.
 * @returns Inner filter records (empty when the tree is absent).
 */
function innerFilterNodes(body: ApiRecord): readonly ApiRecord[] {
  const outer = getIn(body, ['Payload', 'Filters']);
  if (!Array.isArray(outer)) return [];
  return (outer as readonly unknown[]).flatMap(peelInner);
}

/**
 * Whether the body carries at least one `OrigDt` date-range bound.
 * @param body - Parsed request body.
 * @returns True when a BaNCS date-range filter is present.
 */
function hasDateRangeFilter(body: ApiRecord): boolean {
  return innerFilterNodes(body).some(hasOrigDtRange);
}

/**
 * Whether `Payload.Category` includes the CURRENT_ACCOUNT discriminator.
 * @param body - Parsed request body.
 * @returns True when the current-account txn category is present.
 */
function hasCurrentAccountCategory(body: ApiRecord): boolean {
  const category = getIn(body, ['Payload', 'Category']);
  if (!Array.isArray(category)) return false;
  return (category as readonly unknown[]).includes(CURRENT_ACCOUNT_CATEGORY);
}

/**
 * Two-part body guard — CURRENT_ACCOUNT category AND a date-range filter.
 * @param body - Parsed request body.
 * @returns True when the body is a BaNCS transactions query.
 */
function isBancsTxnBody(body: ApiRecord): boolean {
  return hasCurrentAccountCategory(body) && hasDateRangeFilter(body);
}

/**
 * Parse a capture's POST body to a record, or `false` when absent/bad.
 * @param postData - Raw request body string.
 * @returns Parsed record, or false (empty / non-JSON / non-object).
 */
function parsePostBody(postData: string): ApiRecord | false {
  if (postData.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(postData);
    return isRec(parsed) ? parsed : false;
  } catch {
    return false;
  }
}

/**
 * Shape guard — recognises a BaNCS CURRENT_ACCOUNT transactions capture
 * by its `/account` URL and request-body discriminators. Default-deny.
 * @param cap - Captured endpoint surface (url + request body).
 * @returns True when the capture is a BaNCS transactions query.
 */
function isBancsTxnCapture(cap: IBancsCapture): boolean {
  if (!cap.url.includes(ACCOUNT_PATH_FRAGMENT)) return false;
  const body = parsePostBody(cap.postData);
  if (body === false) return false;
  return isBancsTxnBody(body);
}

export { isBancsTxnBody, isBancsTxnCapture };

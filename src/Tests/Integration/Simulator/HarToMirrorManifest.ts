/**
 * HAR → MirrorManifest converter (skeleton).
 *
 * <p>Bridges Playwright-recorded HAR files into rows that can be
 * augmented by the operator into a full {@link IMirrorManifest},
 * letting the existing Mode B {@link MirrorSimulator} replay HAR
 * captures without a duplicate state machine.
 *
 * <p>What this module DOES (operator-independent):
 *
 * <ul>
 *   <li>Read a HAR entry array.</li>
 *   <li>Project each entry to an {@link IHarToManifestRow} bundle —
 *       the same fields a manifest transition holds (method, URL,
 *       status, contentType, headers, body) MINUS the manifest
 *       semantics (phase, advanceTo, predicates, bodyFile path).</li>
 *   <li>Validate HTTP method ∈ {@link MirrorMethod} set.</li>
 * </ul>
 *
 * <p>What this module does NOT do (operator-owned):
 *
 * <ul>
 *   <li>Decide which row belongs to which {@link IntegrationPhase} —
 *       requires the phase-map sidecar captured during harvest.</li>
 *   <li>Write body files to disk — that lives in a later harvester
 *       tool once real HAR captures land.</li>
 *   <li>Add postData / header / cookie predicates — those encode
 *       OTP-challenge and session-cookie invariants that need
 *       per-bank knowledge.</li>
 * </ul>
 *
 * @see ../Mirror/MirrorManifest.ts — target shape.
 * @see ../Mirror/MirrorSimulator.ts — consumer.
 * @see ./HarTypes.ts — source shape.
 */

import { isSome, none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import type { IMirrorResponse, MirrorMethod } from '../Mirror/MirrorManifest.js';
import type { IHarContent, IHarEntry, IHarKeyValue, IHarResponse } from './HarTypes.js';

/** Allowed HTTP methods in {@link MirrorMethod}. */
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

/**
 * Projected row — ready for an operator to augment into an
 * {@link IMirrorTransition}.
 */
interface IHarToManifestRow {
  readonly method: MirrorMethod;
  readonly urlPattern: string;
  readonly response: IMirrorResponse;
  /** Inline body (utf8 text or base64), kept separately from response.bodyFile. */
  readonly inlineBody: string;
  readonly inlineBodyEncoding: 'utf8' | 'base64';
}

/**
 * Test whether `value` is a known {@link MirrorMethod}.
 *
 * @param value - HTTP method string from HAR.
 * @returns True when supported by the mirror simulator.
 */
function isAllowedMethod(value: string): value is MirrorMethod {
  const upper = value.toUpperCase();
  return (ALLOWED_METHODS as readonly string[]).includes(upper);
}

/**
 * Canonicalize the URL the same way {@link StatefulRewriter} does
 * by default: `scheme://host/pathname` (no search/fragment).
 *
 * @param url - Raw URL from HAR.
 * @returns Canonical URL string.
 */
function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Flatten HAR header key/value pairs into a case-insensitive
 * `ReadonlyMap` (keys are lower-cased).
 *
 * Duplicate header names are joined with ", " (RFC 7230 §3.2.2),
 * matching how Playwright's `route.fulfil` accepts headers.
 *
 * @param headers - HAR header array.
 * @returns Frozen map keyed by lower-cased name.
 */
function flattenHeaders(headers: readonly IHarKeyValue[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const { name, value } of headers) {
    const key = name.toLowerCase();
    const existing = map.get(key);
    map.set(key, existing === undefined ? value : `${existing}, ${value}`);
  }
  return map;
}

/**
 * Convert a header `ReadonlyMap` into a plain `Record<string,string>`
 * (preserving the lower-cased keys) for {@link IMirrorResponse.headers}.
 *
 * @param map - Flattened header map.
 * @returns Frozen record (plain object).
 */
function headersToRecord(map: ReadonlyMap<string, string>): Readonly<Record<string, string>> {
  return Object.fromEntries(map);
}

/**
 * Read the `Content-Type` response header, or fall back to
 * `content.mimeType`, or `application/octet-stream`.
 *
 * @param headers - Flattened header map.
 * @param content - HAR content (used for `mimeType` fallback).
 * @returns Resolved content type.
 */
function resolveContentType(headers: ReadonlyMap<string, string>, content: IHarContent): string {
  const explicit = headers.get('content-type');
  if (explicit !== undefined) return explicit;
  if (content.mimeType !== '') return content.mimeType;
  return 'application/octet-stream';
}

/**
 * Build the IMirrorResponse for a HAR response. The `bodyFile` is left
 * empty — operator fills it after writing body to disk.
 *
 * @param harResponse - HAR response object.
 * @returns Partial mirror response with empty `bodyFile`.
 */
function toMirrorResponse(harResponse: IHarResponse): IMirrorResponse {
  const headers = flattenHeaders(harResponse.headers);
  const contentType = resolveContentType(headers, harResponse.content);
  const headerRecord = headersToRecord(headers);
  return { status: harResponse.status, contentType, bodyFile: '', headers: headerRecord };
}

/**
 * Build the inline body fields (text + encoding) for a HAR response.
 *
 * @param response - HAR response object.
 * @returns Tuple of body text and encoding tag.
 */
function pickInlineBody(response: IHarResponse): { text: string; encoding: 'utf8' | 'base64' } {
  const text = response.content.text ?? '';
  const encoding = response.content.encoding === 'base64' ? 'base64' : 'utf8';
  return { text, encoding };
}

/** Args bundle for {@link buildRow}. */
interface IBuildRowArgs {
  readonly method: MirrorMethod;
  readonly urlPattern: string;
  readonly response: IMirrorResponse;
  readonly inline: { text: string; encoding: 'utf8' | 'base64' };
}

/**
 * Assemble an {@link IHarToManifestRow} from its parts.
 *
 * @param args - Row parts.
 * @returns Frozen row.
 */
function buildRow(args: IBuildRowArgs): IHarToManifestRow {
  return {
    method: args.method,
    urlPattern: args.urlPattern,
    response: args.response,
    inlineBody: args.inline.text,
    inlineBodyEncoding: args.inline.encoding,
  };
}

/**
 * Project one HAR entry to an {@link IHarToManifestRow}, returning
 * None when the entry's method is unsupported.
 *
 * @param entry - HAR entry.
 * @returns Some(row) on success; None when method unsupported.
 */
function toManifestRow(entry: IHarEntry): Option<IHarToManifestRow> {
  const methodRaw = entry.request.method.toUpperCase();
  if (!isAllowedMethod(methodRaw)) return none();
  const inline = pickInlineBody(entry.response);
  const urlPattern = canonicalUrl(entry.request.url);
  const response = toMirrorResponse(entry.response);
  const row = buildRow({ method: methodRaw, urlPattern, response, inline });
  return some(row);
}

/**
 * Convert a HAR entry array into manifest rows, dropping entries with
 * unsupported HTTP methods.
 *
 * @param entries - HAR entry array.
 * @returns Frozen rows array.
 */
function toManifestRows(entries: readonly IHarEntry[]): readonly IHarToManifestRow[] {
  const rows: IHarToManifestRow[] = [];
  for (const entry of entries) {
    const projected = toManifestRow(entry);
    if (isSome(projected)) rows.push(projected.value);
  }
  return rows;
}

export { ALLOWED_METHODS, canonicalUrl, flattenHeaders, toManifestRow, toManifestRows };
export type { IHarToManifestRow };

/**
 * Loads + validates a per-bank Mode B mirror manifest from disk.
 *
 * Expected layout (one folder per bank under fixtures/banks/):
 *
 *   src/Tests/Integration/fixtures/banks/<bankId>/
 *     manifest.json           <- IMirrorManifest (this file loads it)
 *     <phase>/<file>.html     <- response body fixtures
 *     <phase>/<file>.json     <- response body fixtures
 *
 * Validation is intentionally strict — a malformed manifest fails the
 * loader rather than producing silent behaviour drift in the simulator.
 * Errors carry the bank id + JSON pointer so contributors can locate
 * the bad entry.
 *
 * Phase 11 part 1: pure load + validate. The actual response body
 * resolution happens inside the simulator so the loader stays I/O
 * minimal and unit-testable with in-memory fixtures.
 *
 * @see ./MirrorManifest.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { isSome, none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import { asIntegrationPhase, type IntegrationPhase } from '../Phases/IntegrationPhase.js';
import type {
  ICookiePredicate,
  IHeaderPredicate,
  IMirrorManifest,
  IMirrorResponse,
  IMirrorTransition,
  IPostDataPredicate,
  MirrorMethod,
  MirrorResourceType,
} from './MirrorManifest.js';

/** HTTP status code lower bound (inclusive). */
const STATUS_MIN = 100;

/** HTTP status code upper bound (exclusive). */
const STATUS_MAX = 600;

/** Methods the manifest may declare (narrowed via `as const`). */
const ALLOWED_METHODS = new Set<MirrorMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
] as const);

/** Resource types the manifest may declare (narrowed via `as const`). */
const ALLOWED_RESOURCE_TYPES = new Set<MirrorResourceType>([
  'document',
  'fetch',
  'xhr',
  'script',
  'stylesheet',
  'image',
  'font',
  'media',
  'websocket',
  'other',
] as const);

/** Arguments for {@link loadMirrorManifest}. */
interface ILoadArgs {
  readonly bankId: string;
  readonly fixturesRoot: string;
}

/** Pair of phases parsed from a manifest root object. */
interface IPhasePair {
  readonly startPhase: IntegrationPhase;
  readonly endPhase: IntegrationPhase;
}

/** Required transition fields after structural extraction. */
interface IRequiredTransitionFields {
  readonly phase: IntegrationPhase;
  readonly method: MirrorMethod;
  readonly urlPattern: string;
}

/** Optional transition fields kept as Option so the builder can unwrap once. */
interface IOptionalTransitionFields {
  readonly resourceType: Option<MirrorResourceType>;
  readonly postData: Option<IPostDataPredicate>;
  readonly headers: Option<readonly IHeaderPredicate[]>;
  readonly cookies: Option<readonly ICookiePredicate[]>;
  readonly advanceTo: Option<IntegrationPhase>;
}

/**
 * Read + validate the manifest for a bank.
 *
 * @param args - Bank id + repository fixtures root.
 * @returns Parsed manifest object.
 */
function loadMirrorManifest(args: ILoadArgs): IMirrorManifest {
  const manifestPath = join(args.fixturesRoot, args.bankId, 'manifest.json');
  const raw = readFileSync(manifestPath, 'utf8');
  const parsed = parseManifestJson(raw, args.bankId);
  return validateManifest(parsed, args.bankId);
}

/**
 * Parse the manifest JSON, throwing ScraperError on bad JSON.
 *
 * @param raw - Raw JSON string.
 * @param bankId - For error message.
 * @returns Parsed JSON as unknown.
 */
function parseManifestJson(raw: string, bankId: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ScraperError(`MirrorManifest bank '${bankId}' is not valid JSON: ${reason}`);
  }
}

/**
 * Validate top-level manifest shape and recurse into transitions.
 *
 * @param parsed - Raw parsed JSON.
 * @param bankId - For error context.
 * @returns Frozen manifest.
 */
function validateManifest(parsed: unknown, bankId: string): IMirrorManifest {
  const obj = expectObject(parsed, `bank '${bankId}' manifest root`);
  const { startPhase, endPhase } = parsePhases(obj, bankId);
  const transitions = parseTransitions(obj, bankId);
  const id = expectString(obj.bankId, `bank '${bankId}' .bankId`);
  const originUrl = expectString(obj.originUrl, `bank '${bankId}' .originUrl`);
  return { bankId: id, originUrl, startPhase, endPhase, transitions };
}

/**
 * Extract the start/end phases from the parsed manifest root.
 *
 * @param obj - Parsed root object.
 * @param bankId - For error context.
 * @returns Validated start/end phase pair.
 */
function parsePhases(obj: Record<string, unknown>, bankId: string): IPhasePair {
  return {
    startPhase: expectPhase(obj.startPhase, `bank '${bankId}' .startPhase`),
    endPhase: expectPhase(obj.endPhase, `bank '${bankId}' .endPhase`),
  };
}

/**
 * Extract the transition list from the parsed manifest root.
 *
 * @param obj - Parsed root object.
 * @param bankId - For error context.
 * @returns Validated transition list.
 */
function parseTransitions(
  obj: Record<string, unknown>,
  bankId: string,
): readonly IMirrorTransition[] {
  const arr = expectArray(obj.transitions, `bank '${bankId}' .transitions`);
  return arr.map((t, i): IMirrorTransition => {
    const ptr = `bank '${bankId}' .transitions[${String(i)}]`;
    return validateTransition(t, ptr);
  });
}

/**
 * Validate one transition entry.
 *
 * @param parsed - Raw transition.
 * @param ptr - JSON pointer for diagnostics.
 * @returns Validated transition.
 */
function validateTransition(parsed: unknown, ptr: string): IMirrorTransition {
  const obj = expectObject(parsed, ptr);
  const required = parseRequiredFields(obj, ptr);
  const optional = parseOptionalFields(obj, ptr);
  const response = validateResponse(obj.response, `${ptr}.response`);
  return buildTransition(required, optional, response);
}

/**
 * Extract the three required transition fields.
 *
 * @param obj - Parsed transition object.
 * @param ptr - JSON pointer for diagnostics.
 * @returns Required fields bundle.
 */
function parseRequiredFields(obj: Record<string, unknown>, ptr: string): IRequiredTransitionFields {
  const rawMethod = expectString(obj.method, `${ptr}.method`);
  return {
    phase: expectPhase(obj.phase, `${ptr}.phase`),
    method: validateMethod(rawMethod, `${ptr}.method`),
    urlPattern: expectString(obj.urlPattern, `${ptr}.urlPattern`),
  };
}

/**
 * Extract the five optional transition fields as Option wrappers.
 *
 * @param obj - Parsed transition object.
 * @param ptr - JSON pointer for diagnostics.
 * @returns Optional fields bundle.
 */
function parseOptionalFields(obj: Record<string, unknown>, ptr: string): IOptionalTransitionFields {
  return {
    resourceType: optionalResourceType(obj.resourceType, `${ptr}.resourceType`),
    postData: optionalPostData(obj.postData, `${ptr}.postData`),
    headers: optionalHeaders(obj.headers, `${ptr}.headers`),
    cookies: optionalCookies(obj.cookies, `${ptr}.cookies`),
    advanceTo: optionalPhase(obj.advanceTo, `${ptr}.advanceTo`),
  };
}

/**
 * Compose the final transition object from validated parts.
 *
 * @param required - Required transition fields.
 * @param optional - Optional transition fields (Option-wrapped).
 * @param response - Validated response payload.
 * @returns Frozen transition.
 */
function buildTransition(
  required: IRequiredTransitionFields,
  optional: IOptionalTransitionFields,
  response: IMirrorResponse,
): IMirrorTransition {
  return { ...required, ...unwrapOptionalFields(optional), response };
}

/**
 * Flatten the Option-wrapped optional fields into a plain object whose
 * absent fields are `undefined` (matches IMirrorTransition's optional keys).
 *
 * @param optional - Optional fields bundle.
 * @returns Plain object suitable for spread.
 */
function unwrapOptionalFields(optional: IOptionalTransitionFields): IUnwrappedOptional {
  return {
    resourceType: isSome(optional.resourceType) ? optional.resourceType.value : undefined,
    postData: isSome(optional.postData) ? optional.postData.value : undefined,
    headers: isSome(optional.headers) ? optional.headers.value : undefined,
    cookies: isSome(optional.cookies) ? optional.cookies.value : undefined,
    advanceTo: isSome(optional.advanceTo) ? optional.advanceTo.value : undefined,
  };
}

/** Plain (non-Option) view of optional transition fields. */
interface IUnwrappedOptional {
  readonly resourceType: MirrorResourceType | undefined;
  readonly postData: IPostDataPredicate | undefined;
  readonly headers: readonly IHeaderPredicate[] | undefined;
  readonly cookies: readonly ICookiePredicate[] | undefined;
  readonly advanceTo: IntegrationPhase | undefined;
}

/**
 * Coerce a raw method string into the enumerated method.
 *
 * @param str - Upper-cased method string.
 * @param ptr - JSON pointer.
 * @returns The validated method.
 */
function validateMethod(str: string, ptr: string): MirrorMethod {
  const upper = str.toUpperCase() as MirrorMethod;
  if (!ALLOWED_METHODS.has(upper)) {
    throw new ScraperError(`MirrorManifest ${ptr} '${str}' not in allowed set`);
  }
  return upper;
}

/**
 * Validate the response sub-object.
 *
 * @param parsed - Raw response.
 * @param ptr - JSON pointer.
 * @returns Validated response.
 */
function validateResponse(parsed: unknown, ptr: string): IMirrorResponse {
  const obj = expectObject(parsed, ptr);
  const status = expectStatus(obj.status, `${ptr}.status`);
  const headersOpt = optionalStringMap(obj.headers, `${ptr}.headers`);
  const headers = isSome(headersOpt) ? headersOpt.value : undefined;
  const contentType = expectString(obj.contentType, `${ptr}.contentType`);
  const bodyFile = expectString(obj.bodyFile, `${ptr}.bodyFile`);
  return { status, contentType, bodyFile, headers };
}

/**
 * Assert that a value is a valid HTTP status code integer.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The validated status code.
 */
function expectStatus(value: unknown, ptr: string): number {
  if (!isValidStatus(value)) {
    throw new ScraperError(`MirrorManifest ${ptr} must be a 3-digit integer`);
  }
  return value;
}

/**
 * Predicate for a valid 3-digit HTTP status integer.
 *
 * @param value - Raw value.
 * @returns True when `value` is an integer within `[STATUS_MIN, STATUS_MAX)`.
 */
function isValidStatus(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  return value >= STATUS_MIN && value < STATUS_MAX;
}

/**
 * Optional resource-type validator.
 *
 * @param value - Raw value (may be undefined).
 * @param ptr - JSON pointer.
 * @returns Some(type) or none.
 */
function optionalResourceType(value: unknown, ptr: string): Option<MirrorResourceType> {
  if (value === undefined) return none();
  const str = expectString(value, ptr);
  if (!ALLOWED_RESOURCE_TYPES.has(str as MirrorResourceType)) {
    throw new ScraperError(`MirrorManifest ${ptr} '${str}' not in allowed resource-type set`);
  }
  return some(str as MirrorResourceType);
}

/**
 * Optional post-data predicate validator.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns Some(predicate) or none.
 */
function optionalPostData(value: unknown, ptr: string): Option<IPostDataPredicate> {
  if (value === undefined) return none();
  const obj = expectObject(value, ptr);
  const shape = expectString(obj.shape, `${ptr}.shape`);
  if (shape !== 'json' && shape !== 'form') {
    throw new ScraperError(`MirrorManifest ${ptr}.shape must be 'json' or 'form'`);
  }
  return some({ shape, expectations: asStringMap(obj.expectations, `${ptr}.expectations`) });
}

/**
 * Optional headers predicate list validator.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns Some(list) or none.
 */
function optionalHeaders(value: unknown, ptr: string): Option<readonly IHeaderPredicate[]> {
  if (value === undefined) return none();
  const list = expectArray(value, ptr).map((entry, i): IHeaderPredicate =>
    parseHeaderPredicate(entry, `${ptr}[${String(i)}]`),
  );
  return some(list);
}

/**
 * Parse one header predicate entry.
 *
 * @param entry - Raw entry value.
 * @param entryPtr - JSON pointer for this entry.
 * @returns Validated predicate.
 */
function parseHeaderPredicate(entry: unknown, entryPtr: string): IHeaderPredicate {
  const obj = expectObject(entry, entryPtr);
  const valueOpt = optionalString(obj.value, `${entryPtr}.value`);
  return {
    name: expectString(obj.name, `${entryPtr}.name`),
    value: isSome(valueOpt) ? valueOpt.value : undefined,
  };
}

/**
 * Optional cookies predicate list validator.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns Some(list) or none.
 */
function optionalCookies(value: unknown, ptr: string): Option<readonly ICookiePredicate[]> {
  if (value === undefined) return none();
  const list = expectArray(value, ptr).map((entry, i): ICookiePredicate =>
    parseCookiePredicate(entry, `${ptr}[${String(i)}]`),
  );
  return some(list);
}

/**
 * Parse one cookie predicate entry.
 *
 * @param entry - Raw entry value.
 * @param entryPtr - JSON pointer for this entry.
 * @returns Validated predicate.
 */
function parseCookiePredicate(entry: unknown, entryPtr: string): ICookiePredicate {
  const obj = expectObject(entry, entryPtr);
  const valueOpt = optionalString(obj.value, `${entryPtr}.value`);
  return {
    name: expectString(obj.name, `${entryPtr}.name`),
    value: isSome(valueOpt) ? valueOpt.value : undefined,
  };
}

/**
 * Assert `value` is a non-null object record; throw with pointer otherwise.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The narrowed object.
 */
function expectObject(value: unknown, ptr: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScraperError(`MirrorManifest ${ptr} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Assert `value` is a string.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The narrowed string.
 */
function expectString(value: unknown, ptr: string): string {
  if (typeof value !== 'string') throw new ScraperError(`MirrorManifest ${ptr} must be a string`);
  return value;
}

/**
 * Assert `value` is an array.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The narrowed array.
 */
function expectArray(value: unknown, ptr: string): unknown[] {
  if (!Array.isArray(value)) throw new ScraperError(`MirrorManifest ${ptr} must be an array`);
  return value;
}

/**
 * Coerce a phase string into the canonical enum value.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The validated phase.
 */
function expectPhase(value: unknown, ptr: string): IMirrorTransition['phase'] {
  const str = expectString(value, ptr);
  const parsed = asIntegrationPhase(str);
  if (!isSome(parsed)) {
    throw new ScraperError(`MirrorManifest ${ptr} '${str}' is not a canonical IntegrationPhase`);
  }
  return parsed.value;
}

/**
 * Optional string-value validator.
 *
 * @param value - Raw value (may be undefined).
 * @param ptr - JSON pointer.
 * @returns Some(string) or none.
 */
function optionalString(value: unknown, ptr: string): Option<string> {
  if (value === undefined) return none();
  const str = expectString(value, ptr);
  return some(str);
}

/**
 * Optional phase validator.
 *
 * @param value - Raw value (may be undefined).
 * @param ptr - JSON pointer.
 * @returns Some(phase) or none.
 */
function optionalPhase(value: unknown, ptr: string): Option<IMirrorTransition['phase']> {
  if (value === undefined) return none();
  const phase = expectPhase(value, ptr);
  return some(phase);
}

/**
 * Optional string-map validator.
 *
 * @param value - Raw value (may be undefined).
 * @param ptr - JSON pointer.
 * @returns Some(map) or none.
 */
function optionalStringMap(value: unknown, ptr: string): Option<Readonly<Record<string, string>>> {
  if (value === undefined) return none();
  const map = asStringMap(value, ptr);
  return some(map);
}

/**
 * Assert `value` is an object whose values are all strings.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The narrowed string-map.
 */
function asStringMap(value: unknown, ptr: string): Readonly<Record<string, string>> {
  const obj = expectObject(value, ptr);
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] !== 'string') {
      throw new ScraperError(`MirrorManifest ${ptr}.${key} must be a string`);
    }
  }
  return obj as Readonly<Record<string, string>>;
}

export type { ILoadArgs };
export { loadMirrorManifest };

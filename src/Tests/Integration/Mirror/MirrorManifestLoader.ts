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
import { asIntegrationPhase } from '../Phases/IntegrationPhase.js';
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

/** Methods the manifest may declare. */
const ALLOWED_METHODS: ReadonlySet<MirrorMethod> = new Set<MirrorMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

/** Resource types the manifest may declare. */
const ALLOWED_RESOURCE_TYPES: ReadonlySet<MirrorResourceType> = new Set<MirrorResourceType>([
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
]);

/** Arguments for {@link loadMirrorManifest}. */
interface ILoadArgs {
  readonly bankId: string;
  readonly fixturesRoot: string;
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
  const startPhase = expectPhase(obj.startPhase, `bank '${bankId}' .startPhase`);
  const endPhase = expectPhase(obj.endPhase, `bank '${bankId}' .endPhase`);
  const transitions = expectArray(obj.transitions, `bank '${bankId}' .transitions`).map(
    (t, i): IMirrorTransition =>
      validateTransition(t, `bank '${bankId}' .transitions[${String(i)}]`),
  );
  return {
    bankId: expectString(obj.bankId, `bank '${bankId}' .bankId`),
    originUrl: expectString(obj.originUrl, `bank '${bankId}' .originUrl`),
    startPhase,
    endPhase,
    transitions,
  };
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
  const methodPtr = `${ptr}.method`;
  const rawMethod = expectString(obj.method, methodPtr);
  const method = validateMethod(rawMethod, methodPtr);
  const resourceTypeOpt = optionalResourceType(obj.resourceType, `${ptr}.resourceType`);
  const postDataOpt = optionalPostData(obj.postData, `${ptr}.postData`);
  const headersOpt = optionalHeaders(obj.headers, `${ptr}.headers`);
  const cookiesOpt = optionalCookies(obj.cookies, `${ptr}.cookies`);
  const advanceToOpt = optionalPhase(obj.advanceTo, `${ptr}.advanceTo`);
  return {
    phase: expectPhase(obj.phase, `${ptr}.phase`),
    method,
    urlPattern: expectString(obj.urlPattern, `${ptr}.urlPattern`),
    resourceType: isSome(resourceTypeOpt) ? resourceTypeOpt.value : undefined,
    postData: isSome(postDataOpt) ? postDataOpt.value : undefined,
    headers: isSome(headersOpt) ? headersOpt.value : undefined,
    cookies: isSome(cookiesOpt) ? cookiesOpt.value : undefined,
    response: validateResponse(obj.response, `${ptr}.response`),
    advanceTo: isSome(advanceToOpt) ? advanceToOpt.value : undefined,
  };
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
  return {
    status,
    contentType: expectString(obj.contentType, `${ptr}.contentType`),
    bodyFile: expectString(obj.bodyFile, `${ptr}.bodyFile`),
    headers: isSome(headersOpt) ? headersOpt.value : undefined,
  };
}

/**
 * Assert that a value is a valid HTTP status code integer.
 *
 * @param value - Raw value.
 * @param ptr - JSON pointer.
 * @returns The validated status code.
 */
function expectStatus(value: unknown, ptr: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < STATUS_MIN ||
    value >= STATUS_MAX
  ) {
    throw new ScraperError(`MirrorManifest ${ptr} must be a 3-digit integer`);
  }
  return value;
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
  const list = expectArray(value, ptr).map((entry, i): IHeaderPredicate => {
    const obj = expectObject(entry, `${ptr}[${String(i)}]`);
    const valueOpt = optionalString(obj.value, `${ptr}[${String(i)}].value`);
    return {
      name: expectString(obj.name, `${ptr}[${String(i)}].name`),
      value: isSome(valueOpt) ? valueOpt.value : undefined,
    };
  });
  return some(list);
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
  const list = expectArray(value, ptr).map((entry, i): ICookiePredicate => {
    const obj = expectObject(entry, `${ptr}[${String(i)}]`);
    const valueOpt = optionalString(obj.value, `${ptr}[${String(i)}].value`);
    return {
      name: expectString(obj.name, `${ptr}[${String(i)}].name`),
      value: isSome(valueOpt) ? valueOpt.value : undefined,
    };
  });
  return some(list);
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

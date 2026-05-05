/**
 * RunStep — generic single-step runner shared by all IStepConfig
 * entries. Hydrates the body + optional query template, signs the
 * canonical bytes when config.signer is present, threads cookies via
 * an IStepCookieJar, fires via bus.apiPost, and extracts the response
 * fields named in step.extractsToCarry.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import { getDebug } from '../../../Types/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiMediator } from '../../Api/ApiMediator.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import { buildCanonical } from '../Crypto/GenericCanonicalStringBuilder.js';
import { signCanonical } from '../Crypto/GenericCryptoSigner.js';
import { extractFields } from '../Envelope/GenericEnvelopeParser.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IStepConfig } from '../IApiDirectCallConfig.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** Header map emitted by buildStepHeaders. */
type HeaderMap = Readonly<Record<string, string>>;

/** Extracted carry record returned by one step. */
type CarryMap = Readonly<Record<string, JsonValue>>;

/** String-valued query record — the opts.query shape accepted by apiPost. */
type QueryRecord = Readonly<Record<string, string>>;


/**
 * Minimal cookie-jar port used across a single config-driven flow.
 * SmsOtpFlow constructs one instance and passes it to every RunStep
 * invocation. Implementations are free (see createSimpleCookieJar).
 */
interface IStepCookieJar {
  add: (setCookieLines: readonly string[]) => number;
  header: () => string;
}

/** Run-step args bundle — respects the 3-param ceiling. */
interface IRunStepArgs {
  readonly step: IStepConfig;
  readonly bus: IApiMediator;
  readonly scope: ITemplateScope;
  readonly companyId: Parameters<typeof resolveWkUrl>[1];
  readonly signingKeypair?: IGenericKeypair;
  readonly cookieJar?: IStepCookieJar;
}

/**
 * Parse a single Set-Cookie line into a [name, value] pair when valid.
 * @param line - Raw Set-Cookie line (first segment before `;`).
 * @returns Tuple or false when malformed.
 */
function parseCookieLine(line: string): readonly [string, string] | false {
  const kv = line.split(';', 1)[0];
  const eq = kv.indexOf('=');
  if (eq <= 0) return false;
  const name = kv.slice(0, eq).trim();
  const value = kv.slice(eq + 1).trim();
  if (name.length === 0) return false;
  return [name, value] as const;
}

/**
 * Add all Set-Cookie lines into the jar (duplicates overwrite).
 * @param jar - Backing map.
 * @param setCookieLines - Raw Set-Cookie lines.
 * @returns Updated jar size.
 */
function ingestCookies(jar: Map<string, string>, setCookieLines: readonly string[]): number {
  const parsedPairs = setCookieLines
    .map(parseCookieLine)
    .filter((p): p is readonly [string, string] => p !== false);
  for (const [name, value] of parsedPairs) jar.set(name, value);
  return jar.size;
}

/**
 * Emit the `k=v; k2=v2` cookie header string from the jar.
 * @param jar - Backing map.
 * @returns Joined cookie header.
 */
function emitCookieHeader(jar: Map<string, string>): string {
  const jarEntries = jar.entries();
  const entries = Array.from(jarEntries);
  const pairs = entries.map(([name, value]): string => `${name}=${value}`);
  return pairs.join('; ');
}

/**
 * Minimal cookie jar — stores last-seen Set-Cookie lines and emits
 * a `k=v; …` header on demand. Duplicate names overwrite.
 * @returns Cookie jar implementation.
 */
function createSimpleCookieJar(): IStepCookieJar {
  const jar = new Map<string, string>();
  return {
    /**
     * Add Set-Cookie lines.
     * @param setCookieLines - Raw Set-Cookie lines.
     * @returns Jar size.
     */
    add(setCookieLines: readonly string[]): number {
      return ingestCookies(jar, setCookieLines);
    },
    /**
     * Emit cookie header.
     * @returns Cookie header string.
     */
    header(): string {
      return emitCookieHeader(jar);
    },
  };
}

/**
 * Coerce a scalar into its string form or false when not scalar.
 * @param v - JsonValue to coerce.
 * @returns String form or false when unsupported.
 */
function scalarToString(v: JsonValue): string | false {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  return false;
}

/**
 * Stringify a hydrated query record — walks the top-level object and
 * coerces each value to its string form. Non-record hydrated query
 * fails.
 * @param hydrated - JsonValue produced by hydrating step.queryTemplate.
 * @returns Procedure with a flat string-string map.
 */
function coerceQueryRecord(hydrated: JsonValue): Procedure<QueryRecord> {
  if (hydrated === null || typeof hydrated !== 'object' || Array.isArray(hydrated)) {
    return fail(ScraperErrorTypes.Generic, 'step.queryTemplate did not hydrate to an object');
  }
  const entries = Object.entries(hydrated);
  const badKey = entries.find(([, v]): boolean => scalarToString(v) === false);
  if (badKey !== undefined) {
    return fail(ScraperErrorTypes.Generic, `queryTemplate[${badKey[0]}] must be a scalar`);
  }
  const pairs = entries.map(([k, v]): [string, string] => [k, scalarToString(v) as string]);
  const out: Record<string, string> = Object.fromEntries(pairs);
  return succeed(out);
}

/**
 * Build the outbound URL query record by hydrating step.queryTemplate.
 * @param step - Step config.
 * @param scope - Template scope.
 * @returns Procedure with the query record (empty when absent).
 */
function buildQueryRecord(step: IStepConfig, scope: ITemplateScope): Procedure<QueryRecord> {
  if (step.queryTemplate === undefined) return succeed({});
  const hydrated = hydrate(step.queryTemplate, scope);
  if (!isOk(hydrated)) return hydrated;
  return coerceQueryRecord(hydrated.value);
}

/**
 * Merge an existing URL's query string with an additional record.
 * Uses encodeURIComponent to match ApiMediator.appendQuery exactly
 * so the canonical signature matches the transport-appended query.
 * @param resolvedUrl - Full URL resolved from WK.
 * @param extra - Additional query pairs.
 * @returns Path + final query string.
 */
function buildPathAndQuery(resolvedUrl: string, extra: QueryRecord): string {
  let pathname: string;
  let search: string;
  try {
    const parsed = new URL(resolvedUrl);
    pathname = parsed.pathname;
    search = parsed.search;
  } catch {
    return resolvedUrl;
  }
  const keys = Object.keys(extra);
  if (keys.length === 0) return `${pathname}${search}`;
  const pairs = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(extra[k])}`);
  const joined = pairs.join('&');
  if (search.length === 0) return `${pathname}?${joined}`;
  return `${pathname}${search}&${joined}`;
}

/** Inputs needed to assemble the signer header value. */
interface ISignerInput {
  readonly pathAndQuery: string;
  readonly bodyJson: string;
  readonly keypair: IGenericKeypair;
}

/**
 * Compute the Content-Signature-style header value per config.signer.
 * @param args - Run-step args bundle (uses scope.config.signer).
 * @param input - Canonical-string inputs for this step.
 * @returns Procedure with the header value.
 */
function computeSignerHeader(args: IRunStepArgs, input: ISignerInput): Procedure<string> {
  const signer = args.scope.config.signer;
  if (signer === undefined) {
    return fail(ScraperErrorTypes.Generic, 'computeSignerHeader called without signer');
  }
  const canonicalProc = buildCanonical({
    canonical: signer.canonical,
    pathAndQuery: input.pathAndQuery,
    bodyJson: input.bodyJson,
  });
  if (!isOk(canonicalProc)) return canonicalProc;
  const bytes = Buffer.from(canonicalProc.value, 'utf8');
  return signCanonical(bytes, input.keypair, signer);
}

/** Inputs used to assemble the outbound header map. */
interface IHeaderAssembly {
  readonly bodyJson: string;
  readonly pathAndQuery: string;
}

/**
 * Seed the outbound header map from staticHeaders (empty when absent).
 * @param staticHeaders - Config.staticHeaders (or empty object when absent).
 * @returns Mutable header map.
 */
function seedHeaders(staticHeaders: Readonly<Record<string, string>>): Record<string, string> {
  return { ...staticHeaders };
}

/**
 * Append the Cookie header to `out` when the jar has any entries.
 * @param out - Mutable outbound header map.
 * @param args - Run-step args.
 * @returns Header map (returned for fluent chaining).
 */
function applyCookieHeader(
  out: Record<string, string>,
  args: IRunStepArgs,
): Record<string, string> {
  if (!args.step.cookieJar) return out;
  if (args.cookieJar === undefined) return out;
  const h = args.cookieJar.header();
  if (h.length === 0) return out;
  out.Cookie = h;
  return out;
}

/**
 * Build the outbound header map — static + signer + optional cookies.
 * @param args - Run-step args.
 * @param assembly - Body JSON + computed pathAndQuery.
 * @returns Procedure with the header map, or signer-failure.
 */
function buildStepHeaders(args: IRunStepArgs, assembly: IHeaderAssembly): Procedure<HeaderMap> {
  const config = args.scope.config;
  const staticHeaders = config.staticHeaders ?? {};
  const seeded = seedHeaders(staticHeaders);
  const out = applyCookieHeader(seeded, args);
  if (config.signer === undefined) return succeed(out);
  if (args.signingKeypair === undefined) {
    return fail(ScraperErrorTypes.Generic, 'signer configured but no signing keypair in scope');
  }
  const sigProc = computeSignerHeader(args, {
    pathAndQuery: assembly.pathAndQuery,
    bodyJson: assembly.bodyJson,
    keypair: args.signingKeypair,
  });
  if (!isOk(sigProc)) return sigProc;
  out[config.signer.headerName] = sigProc.value;
  return succeed(out);
}

/**
 * Merge the new carry map on top of the previous scope's carry.
 * @param scope - Current scope.
 * @param addition - New carry fields from the step.
 * @returns Scope with merged carry (immutable).
 */
function mergeScopeCarry(scope: ITemplateScope, addition: CarryMap): ITemplateScope {
  const merged = { ...scope.carry, ...addition };
  return { ...scope, carry: merged };
}

/** Minimal on-set-cookie callback — adds to jar and returns jar size. */
type OnSetCookie = (cookies: readonly string[]) => number;

/**
 * Build the on-set-cookie callback when step.cookieJar=true. Returns
 * undefined otherwise so apiPost does not register a sink.
 * @param args - Run-step args.
 * @returns Callback or undefined.
 */
/**
 * Forward Set-Cookie lines to a bound jar.
 * @param jar - Bound cookie jar instance.
 * @returns Cookie-sink callback.
 */
function bindJarSink(jar: IStepCookieJar): OnSetCookie {
  /**
   * Jar sink — adds cookies and returns jar size.
   * @param cookies - Raw Set-Cookie lines.
   * @returns Jar size after addition.
   */
  function addToJar(cookies: readonly string[]): number {
    return jar.add(cookies);
  }
  return addToJar;
}

/**
 * Resolve the optional Set-Cookie sink for this step.
 * @param args - Run-step args.
 * @returns Callback when a jar is configured; false otherwise.
 */
function buildOnSetCookie(args: IRunStepArgs): OnSetCookie | false {
  if (!args.step.cookieJar) return false;
  if (args.cookieJar === undefined) return false;
  return bindJarSink(args.cookieJar);
}

/**
 * Merge the optional Set-Cookie sink into the fire bundle.
 * @param fireBase - Fire-call bundle without sink.
 * @param maybe - Result from buildOnSetCookie.
 * @returns Fire-call bundle with onSetCookie present only when truthy.
 */
function attachSink(fireBase: IFireArgs, maybe: OnSetCookie | false): IFireArgs {
  if (maybe === false) return fireBase;
  return { ...fireBase, onSetCookie: maybe };
}

/** Args bundle passed to the transport — keeps runStep short. */
interface IFireArgs {
  readonly body: Record<string, unknown>;
  readonly query: QueryRecord;
  readonly extraHeaders: Record<string, string>;
  readonly onSetCookie?: OnSetCookie;
}

/**
 * Fire the apiPost with the assembled pieces.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @returns Procedure with the parsed response JSON.
 */
async function firePost(args: IRunStepArgs, fire: IFireArgs): Promise<Procedure<JsonValue>> {
  return args.bus.apiPost<JsonValue>(args.step.urlTag, fire.body, {
    extraHeaders: fire.extraHeaders,
    query: fire.query,
    onSetCookie: fire.onSetCookie,
  });
}

/** Diagnostic context shape — PII-safe metadata for log calls. */
interface IStepLogContext {
  readonly stepName: string;
  readonly urlTag: string;
  readonly bodyKeys: readonly string[];
  readonly extractKeys: readonly string[];
}

/** Diagnostic response-shape descriptor — top-level keys + JSON length + envelope error code. */
interface IRespDescriptor {
  readonly respKeys: readonly string[];
  readonly respLength: number;
  readonly errorCode: string;
}

/**
 * Read top-level keys from a JsonValue, returning [] for non-objects.
 * Empty for primitives/arrays so log shape stays uniform.
 * @param value - Any JSON value.
 * @returns Top-level keys (empty for non-objects).
 */
function topLevelKeys(value: JsonValue): readonly string[] {
  if (typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * Build the safe diagnostic context for per-step traces. PII-safe per
 * `logging-pii-guidlines.txt` — only step name, urlTag, body/extract
 * KEY names (not values) are emitted. No passwords, tokens, phone
 * numbers, or response bodies leak.
 * @param step - Step config.
 * @param bodyValue - Hydrated body (only top-level keys are read).
 * @returns Structured context fields ready to splat into log calls.
 */
function buildStepContext(step: IStepConfig, bodyValue: JsonValue): IStepLogContext {
  return {
    stepName: step.name,
    urlTag: step.urlTag,
    bodyKeys: topLevelKeys(bodyValue),
    extractKeys: Object.keys(step.extractsToCarry),
  };
}

/**
 * Read the bank's `error_code` envelope field when present. This is a
 * non-PII enum value (e.g. "00" for success, vendor-specific codes for
 * errors) used by API-envelope banks like Pepper to surface
 * application-level failures inside HTTP 200 responses. Returning the
 * value lets us trace silent error envelopes that the pipeline would
 * otherwise treat as success because HTTP status is 2xx.
 * @param resp - Parsed response JSON.
 * @returns The error_code value when found, '' otherwise.
 */
function readEnvelopeErrorCode(resp: JsonValue): string {
  if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) return '';
  const code = (resp as Record<string, JsonValue>).error_code;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  return '';
}

/**
 * Build the safe response-shape diagnostic. Logs only top-level keys,
 * JSON length, and `error_code` value (non-PII enum). Per
 * `logging-pii-guidlines.txt`, no body content (passwords, tokens,
 * phone numbers, balances) is logged.
 * @param resp - Response JSON value.
 * @returns Top-level keys + length + error_code value.
 */
function describeResponse(resp: JsonValue): IRespDescriptor {
  return {
    respKeys: topLevelKeys(resp),
    respLength: JSON.stringify(resp).length,
    errorCode: readEnvelopeErrorCode(resp),
  };
}

/**
 * Run a single IStepConfig end-to-end. Emits PII-safe DEBUG traces at
 * every transition (start, after-fire, after-extract, fail-fast) so a
 * silent flow becomes inspectable end-to-end. Per `logging-pii-guidlines`,
 * no body values, response payload, headers, or carry values are logged
 * — only structural metadata (key names, urlTag, status length, step
 * name).
 * @param args - Run-step args.
 * @returns Procedure with the extended scope (carry merged), or fail.
 */
async function runStep(args: IRunStepArgs): Promise<Procedure<ITemplateScope>> {
  const bodyProc = hydrate(args.step.body.shape, args.scope);
  if (!isOk(bodyProc)) {
    LOG.debug({ stepName: args.step.name, message: 'hydrate body FAIL' });
    return bodyProc;
  }
  const bodyValue = bodyProc.value;
  const bodyJson = JSON.stringify(bodyValue);
  const baseCtx = buildStepContext(args.step, bodyValue);
  LOG.debug({ ...baseCtx, message: '[runStep] START' });
  const queryProc = buildQueryRecord(args.step, args.scope);
  if (!isOk(queryProc)) {
    LOG.debug({ ...baseCtx, message: 'queryRecord FAIL' });
    return queryProc;
  }
  const urlProc = resolveWkUrl(args.step.urlTag, args.companyId);
  if (!isOk(urlProc)) {
    LOG.debug({ ...baseCtx, message: 'resolveWkUrl FAIL' });
    return urlProc;
  }
  const pathAndQuery = buildPathAndQuery(urlProc.value, queryProc.value);
  const headersProc = buildStepHeaders(args, { bodyJson, pathAndQuery });
  if (!isOk(headersProc)) {
    LOG.debug({ ...baseCtx, message: 'buildStepHeaders FAIL' });
    return headersProc;
  }
  const onSetCookieMaybe = buildOnSetCookie(args);
  const fireBase: IFireArgs = {
    body: bodyValue as Record<string, unknown>,
    query: queryProc.value,
    extraHeaders: headersProc.value,
  };
  const fireWithSink = attachSink(fireBase, onSetCookieMaybe);
  const respProc = await firePost(args, fireWithSink);
  if (!isOk(respProc)) {
    LOG.debug({
      ...baseCtx,
      errorType: respProc.errorType,
      errorMessage: respProc.errorMessage,
      message: '[runStep] firePost FAIL',
    });
    return respProc;
  }
  LOG.debug({ ...baseCtx, ...describeResponse(respProc.value), message: '[runStep] firePost OK' });
  const carryProc = extractFields(respProc.value, args.step.extractsToCarry);
  if (!isOk(carryProc)) {
    LOG.debug({
      ...baseCtx,
      errorMessage: carryProc.errorMessage,
      message: '[runStep] extractFields FAIL',
    });
    return carryProc;
  }
  const carryKeys = Object.keys(carryProc.value);
  LOG.debug({ ...baseCtx, carryKeys, message: '[runStep] OK' });
  const nextScope = mergeScopeCarry(args.scope, carryProc.value);
  return succeed(nextScope);
}

export type { CarryMap, IRunStepArgs, IStepCookieJar };
export { createSimpleCookieJar, runStep };

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
import type {
  IApiDirectCallConfig,
  IAsymmetricSignerConfig,
  IStepConfig,
} from '../IApiDirectCallConfig.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { applyCryptoField, attachBodySignature, primeStepCarry } from './RunStepBodySigning.js';

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
 * Bind the cookie-jar add method to a backing map.
 * @param jar - Backing cookie map.
 * @returns Add function.
 */
function makeCookieJarAdd(jar: Map<string, string>): (lines: readonly string[]) => number {
  /**
   * Add cookies to the jar.
   * @param lines - Raw Set-Cookie lines.
   * @returns Jar size after addition.
   */
  function addToJar(lines: readonly string[]): number {
    return ingestCookies(jar, lines);
  }
  return addToJar;
}

/**
 * Bind the cookie-jar header method to a backing map.
 * @param jar - Backing cookie map.
 * @returns Header function.
 */
function makeCookieJarHeader(jar: Map<string, string>): () => string {
  /**
   * Emit current cookie header.
   * @returns Header string.
   */
  function emit(): string {
    return emitCookieHeader(jar);
  }
  return emit;
}

/**
 * Minimal cookie jar — stores last-seen Set-Cookie lines and emits
 * a `k=v; …` header on demand. Duplicate names overwrite.
 * @returns Cookie jar implementation.
 */
function createSimpleCookieJar(): IStepCookieJar {
  const jar = new Map<string, string>();
  return {
    add: makeCookieJarAdd(jar),
    header: makeCookieJarHeader(jar),
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
 * Convert the validated hydrated-query entries into a string-string
 * record. Extracted from {@link coerceQueryRecord} so the latter
 * stays inside the per-function LOC budget.
 * @param entries - Object entries from the hydrated query template.
 * @returns Procedure with the flat string-string map, or fail.
 */
function buildQueryFromEntries(entries: readonly [string, JsonValue][]): Procedure<QueryRecord> {
  const bad = entries.find(([, v]): boolean => scalarToString(v) === false);
  if (bad !== undefined) {
    return fail(ScraperErrorTypes.Generic, `queryTemplate[${bad[0]}] must be a scalar`);
  }
  const pairs = entries.map(([k, v]): [string, string] => [k, scalarToString(v) as string]);
  const out: Record<string, string> = Object.fromEntries(pairs);
  return succeed(out);
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
  return buildQueryFromEntries(entries);
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

/** Parsed URL parts used by {@link buildPathAndQuery}. */
interface IParsedUrlParts {
  readonly pathname: string;
  readonly search: string;
}

/**
 * Parse a URL or return false when malformed — keeps the
 * try/catch contained.
 * @param resolvedUrl - Full URL string.
 * @returns Parsed parts or false on failure.
 */
function parseUrlOrFalse(resolvedUrl: string): IParsedUrlParts | false {
  try {
    const parsed = new URL(resolvedUrl);
    return { pathname: parsed.pathname, search: parsed.search };
  } catch {
    return false;
  }
}

/**
 * Encode and join query record pairs for URL appending.
 * @param extra - Extra query record.
 * @param keys - Keys to encode (in iteration order).
 * @returns `k1=v1&k2=v2` string.
 */
function encodeQueryPairs(extra: QueryRecord, keys: readonly string[]): string {
  const pairs = keys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(extra[key])}`);
  return pairs.join('&');
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
  const parsed = parseUrlOrFalse(resolvedUrl);
  if (parsed === false) return resolvedUrl;
  const keys = Object.keys(extra);
  if (keys.length === 0) return `${parsed.pathname}${parsed.search}`;
  const joined = encodeQueryPairs(extra, keys);
  if (parsed.search.length === 0) return `${parsed.pathname}?${joined}`;
  return `${parsed.pathname}${parsed.search}&${joined}`;
}

/** Inputs needed to assemble the signer header value. */
interface ISignerInput {
  readonly pathAndQuery: string;
  readonly bodyJson: string;
  readonly keypair: IGenericKeypair;
}

/** Asymmetric (non-AES) signer config — re-exported alias for clarity. */
type NonAesSignerConfig = IAsymmetricSignerConfig;

/**
 * Validate signer presence + non-AES algorithm — extracted so the
 * caller stays inside the per-function LOC budget.
 * @param signer - Optional signer config.
 * @returns Procedure with the narrowed non-AES signer.
 */
function requireNonAesSigner(
  signer: IApiDirectCallConfig['signer'],
): Procedure<NonAesSignerConfig> {
  if (signer === undefined) {
    return fail(ScraperErrorTypes.Generic, 'computeSignerHeader called without signer');
  }
  if (signer.algorithm === 'AES-CBC-PKCS7') {
    return fail(ScraperErrorTypes.Generic, 'computeSignerHeader called with AES signer');
  }
  return succeed(signer);
}

/**
 * Build the canonical bytes for a non-AES signer.
 * @param signer - Validated non-AES signer.
 * @param input - Canonical-string inputs.
 * @returns Procedure with the canonical buffer.
 */
function buildSignerCanonical(signer: NonAesSignerConfig, input: ISignerInput): Procedure<Buffer> {
  const canonicalProc = buildCanonical({
    canonical: signer.canonical,
    pathAndQuery: input.pathAndQuery,
    bodyJson: input.bodyJson,
  });
  if (!isOk(canonicalProc)) return canonicalProc;
  const bytes = Buffer.from(canonicalProc.value, 'utf8');
  return succeed(bytes);
}

/**
 * Compute the Content-Signature-style header value per config.signer.
 * @param args - Run-step args bundle (uses scope.config.signer).
 * @param input - Canonical-string inputs for this step.
 * @returns Procedure with the header value.
 */
function computeSignerHeader(args: IRunStepArgs, input: ISignerInput): Procedure<string> {
  const signerProc = requireNonAesSigner(args.scope.config.signer);
  if (!isOk(signerProc)) return signerProc;
  const signer = signerProc.value;
  const bytesProc = buildSignerCanonical(signer, input);
  if (!isOk(bytesProc)) return bytesProc;
  return signCanonical(bytesProc.value, input.keypair, signer);
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

/** Args bundle for {@link applySignerHeader} — respects the 3-param ceiling. */
interface IApplySignerArgs {
  readonly args: IRunStepArgs;
  readonly assembly: IHeaderAssembly;
  readonly out: Record<string, string>;
  readonly keypair: IGenericKeypair;
}

/**
 * Build the ISignerInput bundle from the apply-args.
 * @param opts - Apply args bundle.
 * @returns Canonical-string input.
 */
function makeSignerInput(opts: IApplySignerArgs): ISignerInput {
  return {
    pathAndQuery: opts.assembly.pathAndQuery,
    bodyJson: opts.assembly.bodyJson,
    keypair: opts.keypair,
  };
}

/**
 * Run computeSignerHeader and attach the result under config.signer.headerName.
 * @param opts - Apply args bundle.
 * @returns Procedure with the merged header map.
 */
function applySignerHeader(opts: IApplySignerArgs): Procedure<HeaderMap> {
  const signerProc = requireNonAesSigner(opts.args.scope.config.signer);
  if (!isOk(signerProc)) return signerProc;
  const input = makeSignerInput(opts);
  const sigProc = computeSignerHeader(opts.args, input);
  if (!isOk(sigProc)) return sigProc;
  opts.out[signerProc.value.headerName] = sigProc.value;
  return succeed(opts.out);
}

/**
 * Attach the signer header to `out` when a non-AES signer is configured.
 * Extracted from {@link buildStepHeaders} so the latter stays inside
 * the per-function LOC budget.
 * @param args - Run-step args.
 * @param assembly - Body JSON + computed pathAndQuery.
 * @param out - Mutable header map.
 * @returns Procedure with the final header map.
 */
function attachSignerHeader(
  args: IRunStepArgs,
  assembly: IHeaderAssembly,
  out: Record<string, string>,
): Procedure<HeaderMap> {
  const config = args.scope.config;
  if (config.signer === undefined) return succeed(out);
  // AES variant signs into the body (not a header) — handled by a
  // separate body-pointer hook before firePost. Skip header attachment.
  if (config.signer.algorithm === 'AES-CBC-PKCS7') return succeed(out);
  if (args.signingKeypair === undefined) {
    return fail(ScraperErrorTypes.Generic, 'signer configured but no signing keypair in scope');
  }
  return applySignerHeader({ args, assembly, out, keypair: args.signingKeypair });
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
  return attachSignerHeader(args, assembly, out);
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
/** Prepared body + scope after hydration / crypto / signing. */
interface IPreparedBody {
  readonly body: Record<string, unknown>;
  readonly scope: ITemplateScope;
}

/**
 * Hydrate the body template, prime carry, and apply cryptoField when
 * configured. Extracted from {@link prepareStepBody} so the latter
 * stays inside the per-function LOC budget.
 * @param args - Run-step args.
 * @param primedScope - Scope after primeStepCarry.
 * @returns Procedure with the pre-signature prepared body.
 */
function hydrateAndCrypto(
  args: IRunStepArgs,
  primedScope: ITemplateScope,
): Procedure<IPreparedBody> {
  const bodyProc = hydrate(args.step.body.shape, primedScope);
  if (!isOk(bodyProc)) return bodyProc;
  const hydratedBody = bodyProc.value as Record<string, unknown>;
  const cryptoArgs = { step: args.step, scope: primedScope, body: hydratedBody };
  const afterCrypto = applyCryptoField(cryptoArgs);
  if (!isOk(afterCrypto)) return afterCrypto;
  return succeed({ body: afterCrypto.value.body, scope: afterCrypto.value.scope });
}

/**
 * Attach the AES body-pointer signature when configured.
 * @param preBody - Pre-signature prepared body.
 * @param pathAndQuery - Canonical pathAndQuery for AES signing.
 * @returns Procedure with the signed body + scope.
 */
function attachBodySig(preBody: IPreparedBody, pathAndQuery: string): Procedure<IPreparedBody> {
  const sigArgs = { scope: preBody.scope, body: preBody.body, pathAndQuery };
  const signedProc = attachBodySignature(sigArgs);
  if (!isOk(signedProc)) return signedProc;
  return succeed({ body: signedProc.value, scope: preBody.scope });
}

/**
 * Resolve the step's body — hydrate template, prime carry (tsMs +
 * AES-signer IV), apply cryptoField encryption when present, and
 * attach the AES body-pointer signature when configured. Extracted
 * from {@link runStep} so the body-prep pipeline is testable in
 * isolation and runStep stays inside the per-function LOC budget.
 * @param args - Run-step args.
 * @param pathAndQuery - Canonical-string path+query (for AES signing).
 * @returns Procedure with the ready-to-POST body + the post-prep scope.
 */
function prepareStepBody(args: IRunStepArgs, pathAndQuery: string): Procedure<IPreparedBody> {
  const primedScope = primeStepCarry(args.scope, args.step);
  const preProc = hydrateAndCrypto(args, primedScope);
  if (!isOk(preProc)) return preProc;
  return attachBodySig(preProc.value, pathAndQuery);
}

/** Bundle of values that prepareDispatch hands off to fireAndMergeScope. */
interface IDispatchBundle {
  readonly fireArgs: IFireArgs;
  readonly fireScope: IRunStepArgs;
  readonly baseCtx: ReturnType<typeof buildStepContext>;
  readonly preparedScope: ITemplateScope;
}

/** Pair of resolved path-and-query and the raw query record. */
interface IPathAndQuery {
  readonly pathAndQuery: string;
  readonly query: Record<string, string>;
}

/**
 * Resolve the URL + query string for the step's WK url tag.
 * @param args - Run-step args (step + scope + companyId).
 * @returns Procedure with the path-and-query bundle, or fail.
 */
function resolvePathAndQuery(args: IRunStepArgs): Procedure<IPathAndQuery> {
  const queryProc = buildQueryRecord(args.step, args.scope);
  if (!isOk(queryProc)) return queryProc;
  const urlProc = resolveWkUrl(args.step.urlTag, args.companyId);
  if (!isOk(urlProc)) return urlProc;
  const pathAndQuery = buildPathAndQuery(urlProc.value, queryProc.value);
  return succeed({ pathAndQuery, query: queryProc.value });
}

/** Args bundle for {@link assembleFire} — respects the 3-param ceiling. */
interface IAssembleFireArgs {
  readonly args: IRunStepArgs;
  readonly preparedBody: IPreparedBody;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string>;
}

/**
 * Build the final IFireArgs bundle including the optional cookie sink.
 * @param opts - Assemble args bundle.
 * @returns Fire-call args ready for firePost.
 */
function assembleFire(opts: IAssembleFireArgs): IFireArgs {
  const fireBase: IFireArgs = {
    body: opts.preparedBody.body,
    query: opts.query,
    extraHeaders: opts.headers,
  };
  const onSetCookie = buildOnSetCookie(opts.args);
  return attachSink(fireBase, onSetCookie);
}

/** Args bundle for {@link finalizeDispatch} — keeps params ≤3. */
interface IPostPrepArgs {
  readonly args: IRunStepArgs;
  readonly preparedBody: IPreparedBody;
  readonly pathAndQuery: string;
  readonly query: Record<string, string>;
}

/**
 * Construct the IFireArgs payload from the prepared body + headers.
 * @param opts - Post-prep args bundle.
 * @param headers - Resolved header map.
 * @returns Fire-call payload.
 */
function makeFireArgs(opts: IPostPrepArgs, headers: Record<string, string>): IFireArgs {
  return assembleFire({
    args: opts.args,
    preparedBody: opts.preparedBody,
    query: opts.query,
    headers,
  });
}

/**
 * Build headers + fire bundle for the post-prep dispatch stage.
 * @param opts - Post-prep args bundle.
 * @param fireScope - Run-step args scoped to the prepared scope.
 * @param baseCtx - Step log context.
 * @returns Procedure with the assembled dispatch bundle.
 */
function headersAndFire(
  opts: IPostPrepArgs,
  fireScope: IRunStepArgs,
  baseCtx: IStepLogContext,
): Procedure<IDispatchBundle> {
  const bodyJson = JSON.stringify(opts.preparedBody.body);
  const headerInput = { bodyJson, pathAndQuery: opts.pathAndQuery };
  const headersProc = buildStepHeaders(fireScope, headerInput);
  if (!isOk(headersProc)) return headersProc;
  const fireArgs = makeFireArgs(opts, headersProc.value);
  const preparedScope = opts.preparedBody.scope;
  return succeed({ fireArgs, fireScope, baseCtx, preparedScope });
}

/**
 * Assemble fireScope + baseCtx and delegate to {@link headersAndFire}.
 * @param opts - Post-prep args bundle.
 * @returns Procedure with the dispatch bundle.
 */
function finalizeDispatch(opts: IPostPrepArgs): Procedure<IDispatchBundle> {
  const fireScope = { ...opts.args, scope: opts.preparedBody.scope };
  const baseCtx = buildStepContext(opts.args.step, opts.preparedBody.body as JsonValue);
  LOG.debug({ ...baseCtx, message: '[runStep] START' });
  return headersAndFire(opts, fireScope, baseCtx);
}

/**
 * Hydrate the request body and build the dispatch bundle.
 * @param args - Run-step args.
 * @param pathAndQuery - Resolved path-and-query string.
 * @param query - Raw query record.
 * @returns Procedure with the dispatch bundle, or fail.
 */
function buildDispatchBundle(
  args: IRunStepArgs,
  pathAndQuery: string,
  query: Record<string, string>,
): Procedure<IDispatchBundle> {
  const prepProc = prepareStepBody(args, pathAndQuery);
  if (!isOk(prepProc)) return prepProc;
  return finalizeDispatch({ args, preparedBody: prepProc.value, pathAndQuery, query });
}

/**
 * Fold the response carry into the prepared scope.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with the merged scope.
 */
function extractAndMerge(bundle: IDispatchBundle, resp: JsonValue): Procedure<ITemplateScope> {
  const carryProc = extractFields(resp, bundle.fireScope.step.extractsToCarry);
  if (!isOk(carryProc)) return carryProc;
  const merged = mergeScopeCarry(bundle.preparedScope, carryProc.value);
  return succeed(merged);
}

/**
 * Log a fire-post failure (PII-safe). Returns true so the caller can
 * chain via a regular statement without invoking a void-returning
 * helper (project rule bans `: void`).
 * @param bundle - Dispatch bundle.
 * @param errorMessage - Error message from the failed post.
 * @returns Sentinel true.
 */
function logFireFail(bundle: IDispatchBundle, errorMessage: string): true {
  const errCtx = { ...bundle.baseCtx, errorMessage };
  LOG.debug({ ...errCtx, message: 'firePost FAIL' });
  return true;
}

/**
 * Log a successful fire-post outcome (PII-safe).
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Sentinel true.
 */
function logFireOk(bundle: IDispatchBundle, resp: JsonValue): true {
  const okCtx = { ...bundle.baseCtx, ...describeResponse(resp) };
  LOG.debug({ ...okCtx, message: '[runStep] firePost OK' });
  return true;
}

/**
 * Dispatch the prepared call and fold the extracted carry into scope.
 * @param bundle - Dispatch bundle from {@link buildDispatchBundle}.
 * @returns Procedure with the merged scope, or fail.
 */
async function fireAndMergeScope(bundle: IDispatchBundle): Promise<Procedure<ITemplateScope>> {
  const respProc = await firePost(bundle.fireScope, bundle.fireArgs);
  if (!isOk(respProc)) {
    logFireFail(bundle, respProc.errorMessage);
    return respProc;
  }
  logFireOk(bundle, respProc.value);
  return extractAndMerge(bundle, respProc.value);
}

/**
 * Run a single IStepConfig end-to-end — body hydration + optional
 * AES body-pointer signing + optional cryptoField encryption +
 * dispatch + response extraction. Emits PII-safe debug traces at
 * START / firePost-OK / firePost-FAIL.
 * @param args - Run-step args (step config + bus + scope + companyId).
 * @returns Procedure with the extended scope (carry merged), or fail.
 */
async function runStep(args: IRunStepArgs): Promise<Procedure<ITemplateScope>> {
  const resolved = resolvePathAndQuery(args);
  if (!isOk(resolved)) return resolved;
  const { pathAndQuery, query } = resolved.value;
  const bundleProc = buildDispatchBundle(args, pathAndQuery, query);
  if (!isOk(bundleProc)) return bundleProc;
  return fireAndMergeScope(bundleProc.value);
}

export type { CarryMap, IRunStepArgs, IStepCookieJar };
export { createSimpleCookieJar, runStep };

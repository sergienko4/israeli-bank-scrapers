/**
 * RunStep — generic single-step runner shared by all IStepConfig
 * entries. Hydrates the body + optional query template, signs the
 * canonical bytes when config.signer is present, threads cookies via
 * an IStepCookieJar, fires via bus.apiPost, and extracts the response
 * fields named in step.extractsToCarry.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import { getDebug } from '../../../Types/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiMediator } from '../../Api/ApiMediator.js';
import { signAesCbcPkcs7 } from '../Crypto/AesSymmetricSigner.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import { buildCanonical } from '../Crypto/GenericCanonicalStringBuilder.js';
import { signCanonical } from '../Crypto/GenericCryptoSigner.js';
import { extractFields } from '../Envelope/GenericEnvelopeParser.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type {
  IAesSignerConfig,
  ICryptoFieldConfig,
  ISignerConfig,
  IStepConfig,
  RefToken,
} from '../IApiDirectCallConfig.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { resolveRef } from '../Template/RefResolver.js';

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
  // Caller (buildStepHeaders) guarantees signer is defined and is the
  // asymmetric variant before invoking this helper; the union narrow
  // happens here via the algorithm discriminator. Keep this assertion
  // explicit so the TS compiler can prove the asymmetric type.
  if (signer === undefined || signer.algorithm === 'AES-CBC-PKCS7') {
    return fail(ScraperErrorTypes.Generic, 'computeSignerHeader requires asymmetric signer');
  }
  const canonicalProc = buildCanonical({
    canonical: signer.canonical,
    pathAndQuery: input.pathAndQuery,
    bodyJson: input.bodyJson,
    carry: args.scope.carry,
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
  // AES signers attach to the body via a JSON pointer in a later
  // RunStep hook; they emit no header. Skipping here keeps the
  // outbound header map untouched for the AES variant.
  if (config.signer.algorithm === 'AES-CBC-PKCS7') return succeed(out);
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

/** AES-CBC IV length — 16 bytes, bound by the AES block size. */
const AES_IV_BYTES = 16;

/**
 * Generate a fresh 32-char lowercase-hex string from 16 random bytes.
 * @returns Hex-encoded random IV.
 */
function randomHex16(): string {
  return randomBytes(AES_IV_BYTES).toString('hex');
}

/**
 * Extract the carry slot name from a `carry.<slot>` RefToken. The
 * caller's TypeScript contract guarantees the `carry.` prefix on
 * every consumer of this helper, so no runtime check is required.
 * @param ref - RefToken expected to begin with `carry.`.
 * @returns Slot name.
 */
function extractCarrySlot(ref: `carry.${string}`): string {
  return ref.slice('carry.'.length);
}

/**
 * Resolve a RefToken to a UTF-8 Buffer. Used by the AES hooks to turn
 * `keyRef` strings (config.<path> | carry.<slot>) into key bytes.
 * @param keyRef - The ref token.
 * @param scope - Template scope.
 * @returns Procedure with the resolved bytes.
 */
function resolveKeyBytes(keyRef: RefToken, scope: ITemplateScope): Procedure<Buffer> {
  const refProc = resolveRef(keyRef, scope);
  if (!isOk(refProc)) return refProc;
  if (typeof refProc.value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `keyRef ${keyRef} did not resolve to a string`);
  }
  const bytes = Buffer.from(refProc.value, 'utf8');
  return succeed(bytes);
}

/**
 * Read a hex-encoded IV from a named carry slot, returning a Buffer.
 * @param slot - Carry slot name.
 * @param scope - Template scope.
 * @returns Procedure with the decoded IV buffer.
 */
function resolveIvBytes(slot: string, scope: ITemplateScope): Procedure<Buffer> {
  const raw = scope.carry[slot];
  if (typeof raw !== 'string') {
    return fail(ScraperErrorTypes.Generic, `iv carry slot ${slot} missing or non-string`);
  }
  const bytes = Buffer.from(raw, 'hex');
  return succeed(bytes);
}

/** Args bundle for {@link primeStepIvs}. */
interface IPrimeStepIvsArgs {
  readonly carry: Readonly<Record<string, JsonValue>>;
  readonly signer: ISignerConfig | undefined;
  readonly cryptoField: ICryptoFieldConfig | undefined;
}

/**
 * Generate fresh 16-byte hex IVs into the named carry slots. Always
 * overwrites — every step entry deposits new randomness so AES never
 * reuses an IV with the same key+plaintext pair.
 * @param args - Carry + signer + optional cryptoField config.
 * @returns Procedure with the IV-primed carry.
 */
/**
 * Apply the cryptoField IV deposit when a cryptoField is declared.
 * @param next - Mutable carry record being primed.
 * @param cryptoField - Optional cryptoField config.
 * @returns Procedure marking success (or fail when ivRef is malformed).
 */
function primeCryptoFieldIv(
  next: Record<string, JsonValue>,
  cryptoField?: ICryptoFieldConfig,
): boolean {
  if (cryptoField === undefined) return false;
  const slot = extractCarrySlot(cryptoField.ivRef);
  next[slot] = randomHex16();
  return true;
}

/**
 * Generate fresh IVs into the carry slots referenced by the signer +
 * step.preHook.cryptoField configs.
 * @param args - Carry + signer + optional cryptoField config.
 * @returns Procedure with the IV-primed carry.
 */
function primeStepIvs(args: IPrimeStepIvsArgs): Readonly<Record<string, JsonValue>> {
  const next: Record<string, JsonValue> = { ...args.carry };
  if (args.signer?.algorithm === 'AES-CBC-PKCS7') {
    next[args.signer.ivCarrySlot] = randomHex16();
  }
  primeCryptoFieldIv(next, args.cryptoField);
  return next;
}

/** Args bundle for {@link applyCryptoField}. */
interface ICryptoFieldArgs {
  readonly carry: Readonly<Record<string, JsonValue>>;
  readonly body: Record<string, unknown>;
  readonly cryptoField: {
    readonly keyBytes: Buffer;
    readonly ivBytes: Buffer;
    readonly outputPostfix?: string;
    readonly writeTo: string;
    readonly scrubFromCarry: string;
  };
}

/** Result of {@link applyCryptoField} — updated carry + body. */
interface ICryptoFieldResult {
  readonly carry: Readonly<Record<string, JsonValue>>;
  readonly body: Record<string, unknown>;
}

/**
 * Encrypt the carry-side plaintext at scrubFromCarry into the body at
 * writeTo, then redact the plaintext from the returned carry. The
 * caller supplies already-resolved key + iv bytes (key/iv resolution
 * happens upstream in {@link runCryptoFieldHook}).
 * @param args - carry + body + cryptoField bundle.
 * @returns Procedure with updated carry + body.
 */
function applyCryptoField(args: ICryptoFieldArgs): Procedure<ICryptoFieldResult> {
  const plaintext = args.carry[args.cryptoField.scrubFromCarry];
  if (typeof plaintext !== 'string') {
    return fail(
      ScraperErrorTypes.Generic,
      `cryptoField: carry.${args.cryptoField.scrubFromCarry} is missing or non-string`,
    );
  }
  const signed = signAesCbcPkcs7({
    plaintext,
    keyBytes: args.cryptoField.keyBytes,
    ivBytes: args.cryptoField.ivBytes,
    outputPostfix: args.cryptoField.outputPostfix,
  });
  if (!isOk(signed)) return signed;
  const attached = attachBodySignature({
    body: args.body,
    pointer: args.cryptoField.writeTo,
    value: signed.value,
  });
  if (!isOk(attached)) return attached;
  const redactedCarry: Record<string, JsonValue> = {
    ...args.carry,
    [args.cryptoField.scrubFromCarry]: `[REDACTED:${args.cryptoField.scrubFromCarry}]`,
  };
  return succeed({ carry: redactedCarry, body: attached.value });
}

/** Args bundle for {@link runCryptoFieldHook}. */
interface IRunCryptoFieldArgs {
  readonly cryptoField: ICryptoFieldConfig;
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
}

/**
 * Resolve the cryptoField config's keyRef + ivRef, then invoke
 * {@link applyCryptoField} to encrypt the awaited plaintext into the
 * body and redact the carry slot.
 * @param args - cryptoField + scope + body bundle.
 * @returns Procedure with the updated carry + body.
 */
function runCryptoFieldHook(args: IRunCryptoFieldArgs): Procedure<ICryptoFieldResult> {
  const keyBytesProc = resolveKeyBytes(args.cryptoField.keyRef, args.scope);
  if (!isOk(keyBytesProc)) return keyBytesProc;
  const slot = extractCarrySlot(args.cryptoField.ivRef);
  const ivBytesProc = resolveIvBytes(slot, args.scope);
  if (!isOk(ivBytesProc)) return ivBytesProc;
  return applyCryptoField({
    carry: args.scope.carry,
    body: args.body,
    cryptoField: {
      keyBytes: keyBytesProc.value,
      ivBytes: ivBytesProc.value,
      outputPostfix: args.cryptoField.outputPostfix,
      writeTo: args.cryptoField.writeTo,
      scrubFromCarry: args.cryptoField.scrubFromCarry,
    },
  });
}

/** Args bundle for {@link runBodySignatureHook}. */
interface IRunBodySignatureArgs {
  readonly signer: IAesSignerConfig;
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
  readonly pathAndQuery: string;
}

/** Resolved key + IV pair fed to the AES signer. */
interface IResolvedAesMaterial {
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
}

/**
 * Resolve the AES key + iv pair from the signer config + scope. Splits
 * the lookups out of {@link runBodySignatureHook} so each helper stays
 * inside the 10-line ceiling.
 * @param signer - AES signer config (keyRef + ivCarrySlot).
 * @param scope - Template scope (carry + config).
 * @returns Procedure with the resolved key/iv pair.
 */
function resolveAesMaterial(
  signer: IAesSignerConfig,
  scope: ITemplateScope,
): Procedure<IResolvedAesMaterial> {
  const keyBytesProc = resolveKeyBytes(signer.keyRef, scope);
  if (!isOk(keyBytesProc)) return keyBytesProc;
  const ivBytesProc = resolveIvBytes(signer.ivCarrySlot, scope);
  if (!isOk(ivBytesProc)) return ivBytesProc;
  return succeed({ keyBytes: keyBytesProc.value, ivBytes: ivBytesProc.value });
}

/**
 * Build the canonical string for an AES signer step.
 * @param args - signer + scope + body + pathAndQuery bundle.
 * @returns Procedure with the canonical string.
 */
function buildAesCanonical(args: IRunBodySignatureArgs): Procedure<string> {
  return buildCanonical({
    canonical: args.signer.canonical,
    pathAndQuery: args.pathAndQuery,
    bodyJson: JSON.stringify(args.body),
    carry: args.scope.carry,
  });
}

/** Plaintext + key/iv bundle consumed by {@link signAesCbcPkcs7}. */
interface IAesSignInputs {
  readonly plaintext: string;
  readonly material: IResolvedAesMaterial;
  readonly outputPostfix: IAesSignerConfig['outputPostfix'];
}

/**
 * Run the AES-CBC-PKCS7 sign primitive over the canonical plaintext.
 * @param inputs - Plaintext + key/iv + postfix bundle.
 * @returns Procedure with the base64 ciphertext (postfix-appended).
 */
function performAesSign(inputs: IAesSignInputs): Procedure<string> {
  return signAesCbcPkcs7({
    plaintext: inputs.plaintext,
    keyBytes: inputs.material.keyBytes,
    ivBytes: inputs.material.ivBytes,
    outputPostfix: inputs.outputPostfix,
  });
}

/**
 * Build the canonical string for the AES signer, encrypt it with the
 * resolved key + iv, and inject the ciphertext into the body at
 * `signer.bodySignatureField`. Bank-agnostic — every detail (canonical
 * parts, signing key, iv slot, output pointer) comes from data.
 * @param args - signer + scope + body + pathAndQuery bundle.
 * @returns Procedure with the body containing the attached signature.
 */
function runBodySignatureHook(args: IRunBodySignatureArgs): Procedure<Record<string, unknown>> {
  const material = resolveAesMaterial(args.signer, args.scope);
  if (!isOk(material)) return material;
  const canonical = buildAesCanonical(args);
  if (!isOk(canonical)) return canonical;
  const signed = performAesSign({
    plaintext: canonical.value,
    material: material.value,
    outputPostfix: args.signer.outputPostfix,
  });
  if (!isOk(signed)) return signed;
  return attachBodySignature({
    body: args.body,
    pointer: args.signer.bodySignatureField,
    value: signed.value,
  });
}

/** Args bundle for {@link primeCarry} — shrinks runStep's prologue. */
interface IPrimeCarryArgs {
  readonly scope: ITemplateScope;
  readonly step: IStepConfig;
}

/**
 * Run the per-step carry primers (time + IVs) in order.
 * @param args - Current scope + step.
 * @returns Procedure with the primed scope.
 */
function primeCarry(args: IPrimeCarryArgs): ITemplateScope {
  // primeStepInstant is total — the Procedure wrapper exists only for
  // the exported unit-test surface, so `.value` is always present.
  const timed = primeStepInstant({ carry: args.scope.carry }) as {
    readonly value: Readonly<Record<string, JsonValue>>;
  };
  const ived = primeStepIvs({
    carry: timed.value,
    signer: args.scope.config.signer,
    cryptoField: args.step.preHook?.cryptoField,
  });
  return { ...args.scope, carry: ived };
}

/** Args bundle for {@link applyAesHooks}. */
interface IApplyAesHooksArgs {
  readonly scope: ITemplateScope;
  readonly step: IStepConfig;
  readonly body: Record<string, unknown>;
  readonly pathAndQuery: string;
}

/** Output bundle for {@link applyAesHooks} — updated scope + body. */
interface IAesHookResult {
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
}

/**
 * Run the cryptoField hook (if declared) then the body-signature hook
 * (if AES signer). Returns the post-hook scope + body so the caller
 * uses the redacted carry on response merge and fires the signed body.
 * @param args - scope + step + body + pathAndQuery.
 * @returns Procedure with the updated scope + body.
 */
/**
 * Apply the cryptoField hook when the step declares one.
 * @param state - Current scope + body.
 * @param step - Step config (read step.preHook?.cryptoField).
 * @returns Procedure with the (possibly updated) state.
 */
function maybeApplyCryptoField(
  state: IAesHookResult,
  step: IStepConfig,
): Procedure<IAesHookResult> {
  const cryptoField = step.preHook?.cryptoField;
  if (cryptoField === undefined) return succeed(state);
  const cfProc = runCryptoFieldHook({ cryptoField, scope: state.scope, body: state.body });
  if (!isOk(cfProc)) return cfProc;
  const nextScope: ITemplateScope = { ...state.scope, carry: cfProc.value.carry };
  return succeed({ scope: nextScope, body: cfProc.value.body });
}

/** Args bundle for {@link maybeApplyBodySignature} — keeps params ≤3. */
interface IMaybeBodySignatureArgs {
  readonly state: IAesHookResult;
  readonly pathAndQuery: string;
}

/**
 * Apply the body-signature hook when the signer is AES-CBC-PKCS7.
 * @param args - state + pathAndQuery bundle.
 * @returns Procedure with the (possibly updated) state.
 */
function maybeApplyBodySignature(args: IMaybeBodySignatureArgs): Procedure<IAesHookResult> {
  const signer = args.state.scope.config.signer;
  if (signer?.algorithm !== 'AES-CBC-PKCS7') return succeed(args.state);
  const sigProc = runBodySignatureHook({
    signer,
    scope: args.state.scope,
    body: args.state.body,
    pathAndQuery: args.pathAndQuery,
  });
  if (!isOk(sigProc)) return sigProc;
  return succeed({ scope: args.state.scope, body: sigProc.value });
}

/**
 * Run the cryptoField hook (when declared) then the body-signature hook
 * (when AES signer). Returns the post-hook scope + body so the caller
 * uses the redacted carry on response merge and fires the signed body.
 * @param args - scope + step + body + pathAndQuery.
 * @returns Procedure with the updated scope + body.
 */
function applyAesHooks(args: IApplyAesHooksArgs): Procedure<IAesHookResult> {
  const initial: IAesHookResult = { scope: args.scope, body: args.body };
  const afterCryptoProc = maybeApplyCryptoField(initial, args.step);
  if (!isOk(afterCryptoProc)) return afterCryptoProc;
  return maybeApplyBodySignature({
    state: afterCryptoProc.value,
    pathAndQuery: args.pathAndQuery,
  });
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
  const primedScope = primeCarry({ scope: args.scope, step: args.step });
  const bodyProc = hydrate(args.step.body.shape, primedScope);
  if (!isOk(bodyProc)) {
    LOG.debug({ stepName: args.step.name, message: 'hydrate body FAIL' });
    return bodyProc;
  }
  const hydratedBody = bodyProc.value;
  const baseCtx = buildStepContext(args.step, hydratedBody);
  LOG.debug({ ...baseCtx, message: '[runStep] START' });
  const queryProc = buildQueryRecord(args.step, primedScope);
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
  const aesProc = applyAesHooks({
    scope: primedScope,
    step: args.step,
    body: hydratedBody as Record<string, unknown>,
    pathAndQuery,
  });
  if (!isOk(aesProc)) {
    LOG.debug({ ...baseCtx, message: 'applyAesHooks FAIL' });
    return aesProc;
  }
  const hookedScope = aesProc.value.scope;
  const finalBody = aesProc.value.body;
  const bodyJson = JSON.stringify(finalBody);
  const headersProc = buildStepHeaders({ ...args, scope: hookedScope }, { bodyJson, pathAndQuery });
  if (!isOk(headersProc)) {
    LOG.debug({ ...baseCtx, message: 'buildStepHeaders FAIL' });
    return headersProc;
  }
  const onSetCookieMaybe = buildOnSetCookie(args);
  const fireBase: IFireArgs = {
    body: finalBody,
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
  const nextScope = mergeScopeCarry(hookedScope, carryProc.value);
  return succeed(nextScope);
}

/** Args bundle for {@link primeStepInstant} — respects 3-param ceiling. */
interface IPrimerArgs {
  readonly carry: Readonly<Record<string, unknown>>;
}

/**
 * Sample Date.now() once per step entry and deposit it into
 * carry.tsMsSlot as a decimal string. Idempotent within a step:
 * when the slot is already populated (e.g. by an earlier hook or
 * by a warm-start payload), the existing value is preserved so the
 * canonical-string + body hydrate + signer all observe the same
 * millisecond.
 * @param args - Current carry bundle.
 * @returns Procedure with a NEW carry record containing tsMsSlot.
 */
function primeStepInstant(args: IPrimerArgs): Procedure<Readonly<Record<string, unknown>>> {
  if (typeof args.carry.tsMsSlot === 'string' && args.carry.tsMsSlot.length > 0) {
    return succeed(args.carry);
  }
  const nowMs = Date.now();
  const nextCarry = { ...args.carry, tsMsSlot: String(nowMs) };
  return succeed(nextCarry);
}

/** Args bundle for {@link attachBodySignature} — respects 3-param ceiling. */
interface IAttachBodySignatureArgs {
  readonly body: Record<string, unknown>;
  readonly pointer: string;
  readonly value: string;
}

/**
 * Decode RFC-6901 pointer escapes — `~1` → `/`, `~0` → `~`. Order matters:
 * `~1` must resolve before `~0` so that an encoded `~` (`~0`) doesn't
 * spuriously recombine with a literal `1` after decoding.
 * @param segment - Raw segment after splitting on `/`.
 * @returns Decoded segment ready for traversal.
 */
function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * Split an RFC-6901 pointer into its parent path + leaf segment.
 * @param pointer - e.g. `/auth/signature`.
 * @returns Procedure with [parentSegments, leaf] or failure on bad pointer.
 */
function splitBodyPointer(pointer: string): Procedure<{
  readonly parents: readonly string[];
  readonly leaf: string;
}> {
  if (pointer.length === 0 || !pointer.startsWith('/')) {
    return fail(ScraperErrorTypes.Generic, `attachBodySignature: invalid pointer ${pointer}`);
  }
  const segments = pointer.slice(1).split('/').map(decodePointerSegment);
  const leaf = segments.at(-1);
  if (leaf === undefined || leaf.length === 0) {
    return fail(ScraperErrorTypes.Generic, `attachBodySignature: invalid pointer ${pointer}`);
  }
  const parents = segments.slice(0, -1);
  return succeed({ parents, leaf });
}

/**
 * Step one parent segment: clone the child record onto the cursor
 * and return the cloned child as the new cursor. Fails when the
 * intermediate node is missing or non-object (e.g. array, scalar,
 * null) so callers see a precise pointer-miss diagnostic.
 * @param cursor - Current cursor object.
 * @param segment - Parent segment to descend through.
 * @returns Procedure with the cloned child cursor.
 */
function stepCloneOnce(
  cursor: Record<string, unknown>,
  segment: string,
): Procedure<Record<string, unknown>> {
  const next = cursor[segment];
  if (next === undefined || typeof next !== 'object' || next === null || Array.isArray(next)) {
    return fail(ScraperErrorTypes.Generic, `attachBodySignature: pointer parent ${segment} miss`);
  }
  const clonedChild = { ...(next as Record<string, unknown>) };
  cursor[segment] = clonedChild;
  return succeed(clonedChild);
}

/**
 * Clone the body shallowly along the pointer path and write the
 * signature value at the leaf. Existing siblings at every level are
 * preserved by reference; only the path nodes are cloned so the
 * caller's input body remains untouched (immutable middleware
 * contract, design-patterns-guidlines.md P2).
 * @param args - body + pointer + value bundle.
 * @returns Procedure with a NEW body object containing the leaf write.
 */
/**
 * Reducer: advance the cursor procedure through one parent segment,
 * short-circuiting on failure. Used by {@link attachBodySignature}
 * to flatten the descent loop and satisfy max-depth-1.
 * @param acc - Accumulated cursor procedure.
 * @param segment - Next parent segment.
 * @returns Updated cursor procedure.
 */
function reduceCursor(
  acc: Procedure<Record<string, unknown>>,
  segment: string,
): Procedure<Record<string, unknown>> {
  if (!acc.success) return acc;
  return stepCloneOnce(acc.value, segment);
}

/**
 * Clone the body shallowly along the pointer path and write the
 * signature value at the leaf. Existing siblings at every level are
 * preserved by reference; only the path nodes are cloned so the
 * caller's input body remains untouched (immutable middleware
 * contract, design-patterns-guidlines.md P2).
 * @param args - body + pointer + value bundle.
 * @returns Procedure with a NEW body object containing the leaf write.
 */
function attachBodySignature(args: IAttachBodySignatureArgs): Procedure<Record<string, unknown>> {
  const split = splitBodyPointer(args.pointer);
  if (!split.success) return split;
  const cloned: Record<string, unknown> = { ...args.body };
  const seed: Procedure<Record<string, unknown>> = succeed(cloned);
  // Wrap reduceCursor in an arrow so Array#reduce can't pass extra
  // positional args (index / array) that would shift our binding.
  const cursorProc = split.value.parents.reduce<Procedure<Record<string, unknown>>>(
    (acc, segment) => reduceCursor(acc, segment),
    seed,
  );
  if (!cursorProc.success) return cursorProc;
  cursorProc.value[split.value.leaf] = args.value;
  return succeed(cloned);
}

export type {
  CarryMap,
  IAttachBodySignatureArgs,
  ICryptoFieldArgs,
  ICryptoFieldResult,
  IPrimerArgs,
  IRunStepArgs,
  IStepCookieJar,
};
export {
  applyCryptoField,
  attachBodySignature,
  createSimpleCookieJar,
  primeStepInstant,
  primeStepIvs,
  runStep,
};

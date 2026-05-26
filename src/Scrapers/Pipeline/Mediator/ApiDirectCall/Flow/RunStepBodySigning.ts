/**
 * RunStep body-signing hooks — step-instant carry primer + cryptoField
 * encryption + AES body-pointer signature attachment.
 *
 * Consumed by {@link RunStep.runStep} just before / after body
 * hydration so the same machinery serves class-z (login bodies with
 * `/signature` at body root) and class-y (post-login envelopes with
 * `/auth/signature` inside the auth block). Zero bank knowledge —
 * everything is driven by the bank's `IAesSignerConfig` + per-step
 * `ICryptoFieldConfig`.
 */

import { randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { signAesCbcPkcs7 } from '../Crypto/AesSymmetricSigner.js';
import { buildCanonical } from '../Crypto/GenericCanonicalStringBuilder.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IAesSignerConfig, ICryptoFieldConfig, IStepConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';

/** IV byte length for AES-CBC (matches block size). */
const IV_BYTES = 16;

/** AES-256 key byte length used by the symmetric signer. */
const AES_KEY_BYTES = 32;

/**
 * Generate a fresh 16-byte IV expressed as 32-char lowercase hex.
 * @returns Random IV hex string.
 */
function freshIvHex(): string {
  const bytes = randomBytes(IV_BYTES);
  return bytes.toString('hex');
}

/**
 * Strip the `carry.` prefix from a RefToken and return the bare slot
 * name. Returns a Procedure so callers chain via `isOk` instead of a
 * sentinel value (Rule P5).
 * @param ref - RefToken like `carry.pinIv1Hex`.
 * @returns Procedure carrying the slot name.
 */
function stripCarryPrefix(ref: string): Procedure<string> {
  const prefix = 'carry.';
  if (!ref.startsWith(prefix)) {
    return fail(ScraperErrorTypes.Generic, `expected carry-ref, got: ${ref}`);
  }
  const slot = ref.slice(prefix.length);
  return succeed(slot);
}

/** Bundle for {@link writeCryptoIvSlot} — slot RefToken + carry target. */
interface ISeedCryptoIvArgs {
  readonly cryptoField: ICryptoFieldConfig;
  readonly carry: Record<string, JsonValue>;
}

/**
 * Seed a fresh IV hex into `carry[cryptoField.ivRef-slot]` when the
 * slot is currently undefined. Idempotent — preserves any caller-set
 * value (used when a step re-runs after a recoverable failure).
 * @param args - cryptoField + mutable carry target.
 * @returns true once the slot is present (existing or freshly set).
 */
function writeCryptoIvSlot(args: ISeedCryptoIvArgs): boolean {
  const slotProc = stripCarryPrefix(args.cryptoField.ivRef);
  if (!isOk(slotProc)) return false;
  const slot = slotProc.value;
  if (slot in args.carry) return true;
  args.carry[slot] = freshIvHex();
  return true;
}

/**
 * Prime step-local carry slots: fresh `tsMs` (request timestamp) and
 * a fresh signing-IV hex into `signer.ivCarrySlot` when the bank
 * uses AES. Also seeds the cryptoField IV slot when the step has a
 * `preHook.cryptoField`.
 * @param scope - Current scope (read-only).
 * @param step - The step about to run (for cryptoField.ivRef).
 * @returns Scope with primed carry.
 */
export function primeStepCarry(scope: ITemplateScope, step: IStepConfig): ITemplateScope {
  const nowMs = Date.now();
  const tsMs = String(nowMs);
  const carry: Record<string, JsonValue> = { ...scope.carry, tsMs };
  const signer = scope.config.signer;
  if (signer?.algorithm === 'AES-CBC-PKCS7') {
    carry[signer.ivCarrySlot] = freshIvHex();
  }
  const cryptoField = step.preHook?.cryptoField;
  if (cryptoField !== undefined) {
    writeCryptoIvSlot({ cryptoField, carry });
  }
  return { ...scope, carry };
}

/** Sentinel returned by ref-resolvers when a slot is missing. */
const REF_MISS = '';

/**
 * Walk a dotted path through a record-of-records, returning the leaf
 * value when found. Returns the {@link REF_MISS} sentinel when any
 * segment isn't an object — keeps the helper free of nullable types.
 * @param root - Root object (e.g. `scope.config`).
 * @param path - Dotted path like `secrets.signKey`.
 * @returns Leaf string value or REF_MISS.
 */
function resolveDottedPath(root: unknown, path: string): string {
  const segments = path.split('.');
  return segments.reduce<unknown>((cursor, seg) => {
    if (cursor === null || typeof cursor !== 'object') return REF_MISS;
    return (cursor as Record<string, unknown>)[seg];
  }, root) as string;
}

/**
 * Resolve a RefToken to its scalar string value in scope (carry /
 * config). Returns {@link REF_MISS} on miss so callers chain through
 * `length === 0` rather than nullable checks.
 * @param ref - RefToken (`carry.*` or `config.*`).
 * @param scope - Current scope.
 * @returns Scalar string (empty when missing).
 */
function resolveRefValue(ref: string, scope: ITemplateScope): string {
  if (ref.startsWith('carry.')) {
    const slot = ref.slice('carry.'.length);
    const value = scope.carry[slot];
    return typeof value === 'string' ? value : REF_MISS;
  }
  if (ref.startsWith('config.')) {
    const path = ref.slice('config.'.length);
    const value = resolveDottedPath(scope.config, path);
    return typeof value === 'string' ? value : REF_MISS;
  }
  return REF_MISS;
}

/**
 * Resolve key bytes from a `config.<dotted.path>` or `carry.<slot>`
 * keyRef. The string is UTF-8-decoded into bytes; the result is
 * truncated to {@link AES_KEY_BYTES} so banks whose literal exceeds
 * 32 bytes (PayBox's signing key is exactly 32 ASCII chars) work
 * without per-bank slicing logic.
 * @param ref - RefToken used as the key reference.
 * @param scope - Current scope.
 * @returns Procedure with key bytes.
 */
function resolveKeyBytes(ref: string, scope: ITemplateScope): Procedure<Buffer> {
  const value = resolveRefValue(ref, scope);
  if (value.length === 0) {
    return fail(ScraperErrorTypes.Generic, `cryptoField: keyRef '${ref}' missing or non-string`);
  }
  const raw = Buffer.from(value, 'utf8');
  const truncated = raw.subarray(0, AES_KEY_BYTES);
  return succeed(truncated);
}

/**
 * Resolve a `carry.<slot>` IV ref → 16 hex bytes decoded to Buffer.
 * @param ref - RefToken used as the IV reference.
 * @param scope - Current scope.
 * @returns Procedure with IV bytes.
 */
function resolveIvBytes(ref: string, scope: ITemplateScope): Procedure<Buffer> {
  const value = resolveRefValue(ref, scope);
  if (value.length === 0) {
    return fail(ScraperErrorTypes.Generic, `cryptoField: ivRef '${ref}' missing or non-string`);
  }
  const bytes = Buffer.from(value, 'hex');
  return succeed(bytes);
}

/** Resolved bytes for the cryptoField AES key. */
interface IResolvedKeyAndIv {
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
}

/**
 * Resolve the key and IV byte buffers for a cryptoField step.
 * @param cryptoField - The cryptoField config.
 * @param scope - Current scope.
 * @returns Procedure with both buffers.
 */
function resolveCryptoFieldKeyIv(
  cryptoField: ICryptoFieldConfig,
  scope: ITemplateScope,
): Procedure<IResolvedKeyAndIv> {
  const keyProc = resolveKeyBytes(cryptoField.keyRef, scope);
  if (!isOk(keyProc)) return keyProc;
  const ivProc = resolveIvBytes(cryptoField.ivRef, scope);
  if (!isOk(ivProc)) return ivProc;
  return succeed({ keyBytes: keyProc.value, ivBytes: ivProc.value });
}

/**
 * Decode an RFC-6901 pointer into its escaped segments (~0 → ~,
 * ~1 → /). Returns the empty array sentinel when the pointer
 * doesn't start with `/`.
 * @param pointer - RFC-6901 pointer (must start with `/`).
 * @returns Decoded segments (empty when malformed).
 */
function decodePointerSegments(pointer: string): readonly string[] {
  if (!pointer.startsWith('/')) return [];
  const raw = pointer.slice(1).split('/');
  return raw.map((p): string => {
    const decodedSlash = p.replaceAll('~1', '/');
    return decodedSlash.replaceAll('~0', '~');
  });
}

/**
 * Pick the child object at `key` or create a fresh empty one.
 * Mutates `parent` when creating.
 * @param parent - Parent object.
 * @param key - Child key.
 * @returns The child (existing or freshly created).
 */
function pickOrCreateChild(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const fresh: Record<string, unknown> = {};
  parent[key] = fresh;
  return fresh;
}

/** Args bundle for {@link descendAndWrite} — keeps recursion params ≤3. */
interface IDescendArgs {
  readonly cursor: Record<string, unknown>;
  readonly parts: readonly string[];
  readonly value: JsonValue;
  readonly root: Record<string, unknown>;
}

/**
 * Descend through pointer segments, creating intermediate objects as
 * needed, and write `value` at the final segment.
 * @param args - Descent bundle.
 * @returns Procedure with the root document.
 */
function descendAndWrite(args: IDescendArgs): Procedure<Record<string, unknown>> {
  const head = args.parts[0];
  const tail = args.parts.slice(1);
  if (tail.length === 0) {
    args.cursor[head] = args.value;
    return succeed(args.root);
  }
  const next = pickOrCreateChild(args.cursor, head);
  return descendAndWrite({ cursor: next, parts: tail, value: args.value, root: args.root });
}

/**
 * Write a value at a JSON pointer inside a mutable plain object.
 * Creates intermediate objects as needed. Pure mutation — callers
 * pass a writable copy (the runStep flow already does, since it
 * created the hydrated body itself).
 * @param doc - Mutable JSON object (top-level must be a plain object).
 * @param pointer - RFC-6901 pointer (e.g. `/auth/signature`).
 * @param value - Value to write at the pointer.
 * @returns Procedure with the (mutated) doc on success.
 */
export function writeAtPointer(
  doc: Record<string, unknown>,
  pointer: string,
  value: JsonValue,
): Procedure<Record<string, unknown>> {
  const parts = decodePointerSegments(pointer);
  if (parts.length === 0) {
    return fail(ScraperErrorTypes.Generic, `writeAtPointer: invalid pointer: ${pointer}`);
  }
  return descendAndWrite({ cursor: doc, parts, value, root: doc });
}

/** Args bundle for {@link applyCryptoField} — keeps params ≤3. */
export interface IApplyCryptoFieldArgs {
  readonly step: IStepConfig;
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
}

/** Result of {@link applyCryptoField} — updated body + scope. */
interface ICryptoFieldResult {
  readonly body: Record<string, unknown>;
  readonly scope: ITemplateScope;
}

/** Args bundle for {@link encryptAndWrite} — keeps the helper short. */
interface IEncryptAndWriteArgs extends IApplyCryptoFieldArgs {
  readonly cryptoField: ICryptoFieldConfig;
  readonly plaintext: string;
}

/**
 * Remove a carry slot — returns a new scope with the slot omitted.
 * Replaces the prior dynamic-delete with a key-filter to satisfy
 * the project's no-dynamic-delete rule.
 * @param scope - Current scope.
 * @param slot - Carry slot to omit.
 * @returns New scope without the slot.
 */
function scrubFromCarry(scope: ITemplateScope, slot: string): ITemplateScope {
  const carryEntries = Object.entries(scope.carry).filter(([k]): boolean => k !== slot);
  const filtered = Object.fromEntries(carryEntries) as Record<string, JsonValue>;
  return { ...scope, carry: filtered };
}

/**
 * Resolve key+iv, encrypt plaintext, write ciphertext to body, scrub
 * carry. Extracted so {@link applyCryptoField} stays inside the
 * per-function LOC budget.
 * @param args - Encryption bundle.
 * @returns Procedure with updated (body, scope).
 */
function encryptAndWrite(args: IEncryptAndWriteArgs): Procedure<ICryptoFieldResult> {
  const keyIvProc = resolveCryptoFieldKeyIv(args.cryptoField, args.scope);
  if (!isOk(keyIvProc)) return keyIvProc;
  const signed = signAesCbcPkcs7({
    plaintext: args.plaintext,
    keyBytes: keyIvProc.value.keyBytes,
    ivBytes: keyIvProc.value.ivBytes,
    outputPostfix: args.cryptoField.outputPostfix,
  });
  if (!isOk(signed)) return signed;
  const writeProc = writeAtPointer(args.body, args.cryptoField.writeTo, signed.value);
  if (!isOk(writeProc)) return writeProc;
  const nextScope = scrubFromCarry(args.scope, args.cryptoField.scrubFromCarry);
  return succeed({ body: writeProc.value, scope: nextScope });
}

/**
 * Apply the optional per-step cryptoField — encrypt the carry value
 * named by `preHook.intoCarryField` and write the result into the
 * outbound body at `cryptoField.writeTo`, then scrub the plaintext
 * from carry. No-op when the step has no cryptoField.
 * @param args - Step + scope + body bundle.
 * @returns Procedure with updated (body, scope).
 */
export function applyCryptoField(args: IApplyCryptoFieldArgs): Procedure<ICryptoFieldResult> {
  const hook = args.step.preHook;
  const cryptoField = hook?.cryptoField;
  if (hook === undefined || cryptoField === undefined) {
    return succeed({ body: args.body, scope: args.scope });
  }
  const plaintext = args.scope.carry[hook.intoCarryField];
  if (typeof plaintext !== 'string') {
    return fail(
      ScraperErrorTypes.Generic,
      `cryptoField: carry.${hook.intoCarryField} missing or non-string`,
    );
  }
  return encryptAndWrite({ cryptoField, plaintext, ...args });
}

/** Args bundle for {@link attachBodySignature} — keeps params ≤3. */
export interface IAttachBodySignatureArgs {
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
  readonly pathAndQuery: string;
}

/** Args bundle for {@link signAndWrite} — keeps it short. */
interface ISignAndWriteArgs {
  readonly signer: IAesSignerConfig;
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
  readonly pathAndQuery: string;
}

/**
 * Compute canonical → sign → write at pointer for the AES signer.
 * @param args - Signing bundle.
 * @returns Procedure with the body (signature written in place).
 */
function signAndWrite(args: ISignAndWriteArgs): Procedure<Record<string, unknown>> {
  const bodyJson = JSON.stringify(args.body);
  const canonicalProc = buildCanonical({
    canonical: args.signer.canonical,
    pathAndQuery: args.pathAndQuery,
    bodyJson,
    carry: args.scope.carry,
  });
  if (!isOk(canonicalProc)) return canonicalProc;
  const keyProc = resolveKeyBytes(args.signer.keyRef, args.scope);
  if (!isOk(keyProc)) return keyProc;
  const ivHex = args.scope.carry[args.signer.ivCarrySlot];
  if (typeof ivHex !== 'string') {
    const slot = args.signer.ivCarrySlot;
    return fail(ScraperErrorTypes.Generic, `signer: carry.${slot} missing`);
  }
  const ivBytes = Buffer.from(ivHex, 'hex');
  const signed = signAesCbcPkcs7({
    plaintext: canonicalProc.value,
    keyBytes: keyProc.value,
    ivBytes,
    outputPostfix: args.signer.outputPostfix,
  });
  if (!isOk(signed)) return signed;
  return writeAtPointer(args.body, args.signer.bodySignatureField, signed.value);
}

/**
 * Sign canonical bytes and write the resulting signature string into
 * the outbound body at `signer.bodySignatureField`. No-op when the
 * bank's signer is asymmetric (header-attached) — that path runs in
 * `buildStepHeaders`.
 * @param args - Signing bundle.
 * @returns Procedure with the updated body.
 */
export function attachBodySignature(
  args: IAttachBodySignatureArgs,
): Procedure<Record<string, unknown>> {
  const signer = args.scope.config.signer;
  if (signer === undefined) return succeed(args.body);
  if (signer.algorithm !== 'AES-CBC-PKCS7') return succeed(args.body);
  return signAndWrite({
    signer,
    body: args.body,
    scope: args.scope,
    pathAndQuery: args.pathAndQuery,
  });
}

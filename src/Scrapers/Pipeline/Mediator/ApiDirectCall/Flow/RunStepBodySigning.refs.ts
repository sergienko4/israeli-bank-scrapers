/**
 * RefToken resolution helpers — read `carry.<slot>` / `config.<path>`
 * scalars and key/IV byte buffers for the body-signing pipeline.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { AES_KEY_BYTES } from './RunStepBodySigning.iv.js';

/** Sentinel returned by ref-resolvers when a slot is missing. */
const REF_MISS = '';

/**
 * Strip the `carry.` prefix from a RefToken and return the bare slot name.
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

/**
 * Walk a dotted path through a record-of-records, returning the leaf value.
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
 * Resolve a `carry.<slot>` ref to its scalar string value.
 * @param ref - RefToken (must start with `carry.`).
 * @param scope - Current scope.
 * @returns Scalar string (REF_MISS when missing).
 */
function resolveCarryRef(ref: string, scope: ITemplateScope): string {
  const slot = ref.slice('carry.'.length);
  const value = scope.carry[slot];
  return typeof value === 'string' ? value : REF_MISS;
}

/**
 * Resolve a `config.<path>` ref to its scalar string value.
 * @param ref - RefToken (must start with `config.`).
 * @param scope - Current scope.
 * @returns Scalar string (REF_MISS when missing).
 */
function resolveConfigRef(ref: string, scope: ITemplateScope): string {
  const path = ref.slice('config.'.length);
  const value = resolveDottedPath(scope.config, path);
  return typeof value === 'string' ? value : REF_MISS;
}

/**
 * Resolve a RefToken to its scalar string value in scope (carry / config).
 * @param ref - RefToken (`carry.*` or `config.*`).
 * @param scope - Current scope.
 * @returns Scalar string (empty when missing).
 */
function resolveRefValue(ref: string, scope: ITemplateScope): string {
  if (ref.startsWith('carry.')) return resolveCarryRef(ref, scope);
  if (ref.startsWith('config.')) return resolveConfigRef(ref, scope);
  return REF_MISS;
}

/**
 * Resolve key bytes from a keyRef. Truncated to AES_KEY_BYTES.
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

export {
  REF_MISS,
  resolveDottedPath,
  resolveIvBytes,
  resolveKeyBytes,
  resolveRefValue,
  stripCarryPrefix,
};

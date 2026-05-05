/**
 * RefResolver — resolves a single RefToken against an ITemplateScope.
 * Handles the 6 token families: fingerprint, uuid, keypair.<role>.<field>,
 * carry.<name>, creds.<field>, config.<path>.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { randomUUID } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { walkPointer } from '../Envelope/JsonPointer.js';
import type { ICollectionResult } from '../Fingerprint/GenericFingerprintBuilder.js';
import type { IApiDirectCallConfig, RefToken } from '../IApiDirectCallConfig.js';

/** Scope passed into every $ref resolution — mediator-populated. */
interface ITemplateScope {
  readonly carry: Readonly<Record<string, JsonValue>>;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly config: IApiDirectCallConfig;
  readonly keypair?: {
    readonly ec?: IGenericKeypair;
    readonly rsa?: IGenericKeypair;
  };
  readonly fingerprint?: ICollectionResult;
}

/** Handler for one RefToken category — returns the resolved value. */
type RefHandler = (token: RefToken, scope: ITemplateScope) => Procedure<JsonValue>;

/** Predicate flag emitted by the prefix matcher for Array.find. */
type PrefixMatch = boolean;

/**
 * Coerce an unknown runtime value into a JsonValue. Arrays + plain
 * objects + scalars pass through; functions + symbols fail.
 * @param value - Arbitrary runtime value (e.g. creds field).
 * @returns Procedure with the coerced JsonValue.
 */
/** Runtime creds value — one of the shapes coerceToJsonValue accepts. */
type CoercibleValue = JsonValue | object;

/**
 * Coerce a coercible creds value to a JsonValue Procedure.
 * @param value - Candidate runtime value.
 * @returns Procedure with the coerced JsonValue or a fail.
 */
function coerceToJsonValue(value: CoercibleValue): Procedure<JsonValue> {
  if (value === null) return succeed(null);
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return succeed(value as JsonValue);
  if (t === 'object') return succeed(value as JsonValue);
  return fail(ScraperErrorTypes.Generic, `ref value is not JSON-serialisable: ${t}`);
}

/**
 * Handle the 'fingerprint' token — requires scope.fingerprint to be
 * populated by SmsOtpFlow prior to template hydration.
 * @param _token - Unused — always 'fingerprint'.
 * @param scope - Template scope.
 * @returns Procedure with the fingerprint block.
 */
function handleFingerprint(_token: RefToken, scope: ITemplateScope): Procedure<JsonValue> {
  if (scope.fingerprint === undefined) {
    return fail(
      ScraperErrorTypes.Generic,
      'ref fingerprint requested but scope.fingerprint is absent',
    );
  }
  return succeed(scope.fingerprint);
}

/**
 * Handle the 'uuid' token — produces a fresh UUID per call.
 * @returns Procedure with a 36-char UUID string.
 */
function handleUuid(): Procedure<JsonValue> {
  const uuid = randomUUID();
  return succeed(uuid);
}

/**
 * Handle the 'now' token — current Unix time in seconds.
 * @returns Procedure with the seconds number.
 */
function handleNow(): Procedure<JsonValue> {
  const nowMs = Date.now();
  const seconds = Math.floor(nowMs / 1000);
  return succeed(seconds);
}

/**
 * Handle the 'nowMs' token — current Unix time in milliseconds.
 * @returns Procedure with the ms number.
 */
function handleNowMs(): Procedure<JsonValue> {
  const nowMs = Date.now();
  return succeed(nowMs);
}

/**
 * Resolve the EC public key from a keypair bundle.
 * @param pair - Keypair bundle.
 * @returns Procedure with the EC public-key base64 string.
 */
function resolveEcKey(pair: NonNullable<ITemplateScope['keypair']>): Procedure<JsonValue> {
  if (pair.ec === undefined) return fail(ScraperErrorTypes.Generic, 'scope.keypair.ec is absent');
  return succeed(pair.ec.publicKeyBase64);
}

/**
 * Resolve the RSA public key from a keypair bundle.
 * @param pair - Keypair bundle.
 * @returns Procedure with the RSA public-key base64 string.
 */
function resolveRsaKey(pair: NonNullable<ITemplateScope['keypair']>): Procedure<JsonValue> {
  if (pair.rsa === undefined) return fail(ScraperErrorTypes.Generic, 'scope.keypair.rsa is absent');
  return succeed(pair.rsa.publicKeyBase64);
}

/**
 * Handle the two fixed 'keypair.{ec|rsa}.publicKeyBase64' tokens.
 * @param token - 'keypair.ec.publicKeyBase64' or 'keypair.rsa.publicKeyBase64'.
 * @param scope - Template scope.
 * @returns Procedure with the public-key base64 string.
 */
function handleKeypair(token: RefToken, scope: ITemplateScope): Procedure<JsonValue> {
  const pair = scope.keypair;
  if (pair === undefined) {
    return fail(ScraperErrorTypes.Generic, `ref ${token} requested but scope.keypair is absent`);
  }
  if (token === 'keypair.ec.publicKeyBase64') return resolveEcKey(pair);
  if (token === 'keypair.rsa.publicKeyBase64') return resolveRsaKey(pair);
  return fail(ScraperErrorTypes.Generic, `unknown keypair ref: ${token}`);
}

/**
 * Handle carry.<name> tokens — look up in scope.carry.
 * @param token - Full ref token.
 * @param scope - Template scope.
 * @returns Procedure with the carry value.
 */
function handleCarry(token: RefToken, scope: ITemplateScope): Procedure<JsonValue> {
  const name = token.slice('carry.'.length);
  if (!Object.hasOwn(scope.carry, name)) {
    return fail(ScraperErrorTypes.Generic, `ref carry.${name} missing from scope.carry`);
  }
  return succeed(scope.carry[name]);
}

/**
 * Handle creds.<field> tokens — look up in scope.creds.
 * @param token - Full ref token.
 * @param scope - Template scope.
 * @returns Procedure with the coerced creds value.
 */
function handleCreds(token: RefToken, scope: ITemplateScope): Procedure<JsonValue> {
  const field = token.slice('creds.'.length);
  const value = (scope.creds as Record<string, CoercibleValue | undefined>)[field];
  if (value === undefined) {
    return fail(ScraperErrorTypes.Generic, `ref creds.${field} missing from scope.creds`);
  }
  return coerceToJsonValue(value);
}

/**
 * Handle config.<dotted.path> tokens — walk the IApiDirectCallConfig.
 * @param token - Full ref token.
 * @param scope - Template scope.
 * @returns Procedure with the resolved config value.
 */
function handleConfig(token: RefToken, scope: ITemplateScope): Procedure<JsonValue> {
  const dotted = token.slice('config.'.length);
  const segments = dotted.split('.');
  const pointer = `/${segments.join('/')}`;
  const walked = walkPointer(scope.config as unknown as JsonValue, pointer);
  if (!isOk(walked)) {
    return fail(ScraperErrorTypes.Generic, `ref config.${dotted} miss`);
  }
  return succeed(walked.value);
}

/** Dispatch table — prefix-match to one of the 6 handler families. */
const PREFIX_HANDLERS: readonly { readonly prefix: string; readonly handle: RefHandler }[] = [
  { prefix: 'keypair.', handle: handleKeypair },
  { prefix: 'carry.', handle: handleCarry },
  { prefix: 'creds.', handle: handleCreds },
  { prefix: 'config.', handle: handleConfig },
];

/**
 * Predicate for PREFIX_HANDLERS.find — tests prefix match.
 * @param token - Token being dispatched.
 * @returns Predicate that returns true when the entry prefix matches.
 */
function prefixMatcher(token: RefToken): (e: (typeof PREFIX_HANDLERS)[number]) => boolean {
  return (e): PrefixMatch => token.startsWith(e.prefix);
}

/**
 * Pick the first matching prefix handler for a token.
 * @param token - Ref token.
 * @returns Handler or false when no prefix matches.
 */
function pickPrefixHandler(token: RefToken): RefHandler | false {
  const matcher = prefixMatcher(token);
  const entry = PREFIX_HANDLERS.find(matcher);
  if (entry === undefined) return false;
  return entry.handle;
}

/**
 * Resolve a RefToken against a scope.
 * @param token - Full ref token.
 * @param scope - Template scope.
 * @returns Procedure with the resolved JsonValue, or unknown-token failure.
 */
function resolveRef(token: RefToken, scope: ITemplateScope): Procedure<JsonValue> {
  if (token === 'fingerprint') return handleFingerprint(token, scope);
  if (token === 'uuid') return handleUuid();
  if (token === 'now') return handleNow();
  if (token === 'nowMs') return handleNowMs();
  const handler = pickPrefixHandler(token);
  if (handler === false) {
    return fail(ScraperErrorTypes.Generic, `unknown ref token: ${token}`);
  }
  return handler(token, scope);
}

export type { ITemplateScope };
export { resolveRef };
export default resolveRef;

/**
 * PayBox getKey BOOTSTRAP — fetches and decrypts the per-session HMAC
 * signing key, then deposits it (plus the transport header-signer config)
 * into the session-context so subsequent authenticated reads carry the
 * required `X-Timestamp`/`X-Nonce`/`X-Signature` headers.
 *
 * <p>getKey itself carries NO `X-Signature` (no key exists yet — the
 * bootstrap exemption), but it IS body-signed like every PayBox DATA call
 * via the shape-level AES signer at `/auth/signature`.
 *
 * <p>PayBox wraps every response in `{ code, content: {…} }`; the key
 * material lives at `content.tsKey` (base64 AES-256-CBC ciphertext) and
 * `content.tsIv` (hex IV). The AES key derives from the caller's phone
 * (normalised to `972-<national>`) plus the fixed key-exchange salt. The
 * derived key is a bearer secret — it is NEVER logged.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { HMAC_KEY_SLOT, HMAC_SIGNER_SLOT } from '../../../Mediator/Api/ApiMediator.hmacHeaders.js';
import type { IDeriveExchangeKeyArgs } from '../../../Mediator/ApiDirectCall/Crypto/HmacKeyExchange.js';
import {
  decryptExchangedHmacKey,
  deriveExchangeKey,
} from '../../../Mediator/ApiDirectCall/Crypto/HmacKeyExchange.js';
import { formatPhoneNumber } from '../../../Mediator/Credentials/PhoneFormatter.js';
import type {
  ApiBody,
  IBootstrapExtractArgs,
  SessionContextPatch,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  KEY_EXCHANGE_SALT,
  PAYBOX_HMAC_HEADER_SIGNER,
} from '../../../Registry/Config/PipelineBankConfigPayBoxCrypto.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { buildAuthEnvelope } from './PayBoxAuthEnvelope.js';

/** Derived-key length (bytes) — HMAC-SHA256 uses a 32-byte key. */
const HMAC_KEY_LEN = 32;
const EXCHANGE_KEY_PAD_CHAR = 'a';

/**
 * getKey request body — the same class-y `auth` envelope every PayBox
 * DATA call sends. The shape-level AES signer overwrites `/auth/signature`.
 * @param ctx - Action context (session-context + creds source).
 * @returns Body vars carrying the auth envelope.
 */
export function getKeyVars(ctx: IActionContext): VarsMap {
  return { auth: buildAuthEnvelope(ctx) };
}

/**
 * True when the wrapped `content` object carries a string `tsKey`.
 * @param body - Raw response body.
 * @returns Whether `content.tsKey` is present as a string.
 */
function contentHasTsKey(body: ApiBody): boolean {
  const content = body.content;
  const obj = content !== null && typeof content === 'object' ? (content as ApiBody) : undefined;
  return typeof obj?.tsKey === 'string';
}

/**
 * Locate the object carrying the key material. PayBox wraps most
 * responses in `{ code, content }`, but getKey's `EncryptionKeyResponse`
 * fields may sit under `content` OR at the root depending on the SDK
 * build — prefer whichever level actually holds a string `tsKey`.
 * @param body - Raw response body.
 * @returns The level bearing `tsKey`, or the root when neither does.
 */
function readContent(body: ApiBody): ApiBody {
  if (contentHasTsKey(body)) return body.content as ApiBody;
  return body;
}

/**
 * Describe a response body for a fail-closed diagnostic WITHOUT leaking
 * secrets: the numeric `code` plus the set of top-level field NAMES only
 * (never their values — `tsKey` is ciphertext of the signing key).
 * @param body - Raw response body.
 * @returns Non-secret shape summary.
 */
function describeShape(body: ApiBody): string {
  const code = typeof body.code === 'number' ? String(body.code) : 'n/a';
  const keys = Object.keys(body).join(',');
  return `code=${code} keys=[${keys}]`;
}

/**
 * Build the fail-closed result when getKey returned no key material,
 * attaching a non-secret shape summary to aid live-run diagnosis.
 * @param body - Raw response body.
 * @returns Failure procedure.
 */
function missingKeyMaterial(body: ApiBody): Procedure<SessionContextPatch> {
  const shape = describeShape(body);
  return fail(ScraperErrorTypes.Generic, `getKey missing key material (${shape})`);
}

/**
 * Read a string field, yielding empty when absent or not a string.
 * @param src - Source object.
 * @param key - Field name.
 * @returns The string value, or empty.
 */
function readString(src: ApiBody, key: string): string {
  const value = src[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Read the caller's phone digits from creds (empty when absent — unit
 * fixtures may construct a partial context without credentials).
 * @param ctx - Action context.
 * @returns Phone digits string, or empty.
 */
function readPhone(ctx: IActionContext): string {
  const raw = (ctx as unknown as { readonly credentials?: { readonly phoneNumber?: string } })
    .credentials;
  return raw?.phoneNumber ?? '';
}

/** Key material read off the getKey response + caller context. */
interface IKeyMaterial {
  readonly phone: string;
  readonly tsKey: string;
  readonly tsIv: string;
}

/**
 * Strip wire-format separators so seed derivation is idempotent. The
 * ApiDirectCall ACTION stage rewrites `credentials.phoneNumber` into the
 * `972-<national>` wire form BEFORE the scrape phase runs, but
 * {@link formatPhoneNumber} requires digits-only input — sanitise first
 * so a raw or already-dashed phone both yield the same seed.
 * @param phone - Phone in raw digits or wire (`972-…`) form.
 * @returns Digits-only international form.
 */
function toDigitsOnly(phone: string): string {
  return phone.replaceAll(/\D+/g, '');
}

/**
 * Build the AES exchange-key derivation args for a dashed phone seed.
 * @param seed - `972-<national>` dashed phone number.
 * @returns Derivation args (seed + fixed salt, length, and pad char).
 */
function buildExchangeKeyArgs(seed: string): IDeriveExchangeKeyArgs {
  return { seed, salt: KEY_EXCHANGE_SALT, length: HMAC_KEY_LEN, padChar: EXCHANGE_KEY_PAD_CHAR };
}

/**
 * Derive the 32-byte HMAC key: normalise phone → `972-<national>`,
 * derive the AES key from `phone + salt`, then AES-256-CBC decrypt tsKey.
 * @param m - Phone + ciphertext + IV.
 * @returns Procedure with the 32-byte HMAC key.
 */
function deriveHmacKey(m: IKeyMaterial): Procedure<Buffer> {
  const digits = toDigitsOnly(m.phone);
  const dash = formatPhoneNumber(digits, 'international-dash');
  if (!isOk(dash)) return dash;
  const args = buildExchangeKeyArgs(dash.value);
  const keyBytes = deriveExchangeKey(args);
  return decryptExchangedHmacKey({ ciphertextB64: m.tsKey, ivHex: m.tsIv, keyBytes });
}

/**
 * Build the session-context patch depositing the key (hex) + the
 * transport header-signer config into the generic transport slots.
 * @param hmacKey - Decrypted 32-byte HMAC key.
 * @returns Patch merged into session-context by the bootstrap driver.
 */
function buildPatch(hmacKey: Buffer): SessionContextPatch {
  return {
    [HMAC_KEY_SLOT]: hmacKey.toString('hex'),
    [HMAC_SIGNER_SLOT]: PAYBOX_HMAC_HEADER_SIGNER,
  };
}

/**
 * Decrypt the getKey response into the HMAC-key session patch.
 * Fail-closed when key material is missing — the authenticated reads it
 * enables would 401 without it.
 * @param args - Response body + action context.
 * @returns Procedure with the session-context patch.
 */
export function extractHmacKeyPatch(args: IBootstrapExtractArgs): Procedure<SessionContextPatch> {
  const content = readContent(args.body);
  const tsKey = readString(content, 'tsKey');
  const tsIv = readString(content, 'tsIv');
  if (tsKey === '' || tsIv === '') return missingKeyMaterial(args.body);
  const key = deriveHmacKey({ phone: readPhone(args.ctx), tsKey, tsIv });
  if (!isOk(key)) return key;
  const patch = buildPatch(key.value);
  return succeed(patch);
}

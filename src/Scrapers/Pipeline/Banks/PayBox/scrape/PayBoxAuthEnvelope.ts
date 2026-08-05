/**
 * PayBox class-y `auth: { … }` body envelope — shared by the
 * AUTHENTICATED DATA calls, with `/sync` as an explicit exception.
 *
 * <p>PayBox carries no `Authorization` header on these calls, so
 * `/getUserHistory` sends the caller's identity — `uId`,
 * `access_token` and the device `uuid` — inside this body envelope
 * instead.
 *
 * <p><b>`/sync` (balance) must NOT use this envelope.</b> It answers
 * HTTP 400 with or without one, but a rejected body carrying the live
 * `access_token` makes PayBox invalidate the session — forensic run
 * 31015484475 shows `/getUserHistory` returning `401 UNAUTHORIZED`
 * 355 ms after a freshly minted token was sent to `/sync`. See
 * `PayBoxShapeHelpers.ts` for the guard that keeps `balanceVars()`
 * empty.
 *
 * <p>`signature` is intentionally blank — the shape-level AES signer
 * overwrites it at the `/auth/signature` pointer after hydration.
 */

import { PAYBOX_AUTH_ENVELOPE_DEFAULTS } from '../../../Registry/Config/PipelineBankConfigPayBox.js';
import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { IPayBoxCreds } from '../PayBoxCreds.js';

/**
 * Read the post-login session-context from the bus on ctx, falling
 * back to an empty object when the mediator slot is empty (test
 * fixtures may omit it).
 * @param ctx - Action context.
 * @returns Frozen session-context bundle.
 */
function readSessionContext(ctx: IActionContext): Readonly<Record<string, unknown>> {
  if (!isSome(ctx.apiMediator)) return {};
  return ctx.apiMediator.value.getSessionContext();
}

/**
 * Read a string field from the session-context bundle.
 * @param session - Frozen session-context bundle.
 * @param key - Field name to read.
 * @returns The string value, or empty when absent or not a string.
 */
function sessionString(session: Readonly<Record<string, unknown>>, key: string): string {
  const value = session[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Read the long-term token from the caller's credentials.
 *
 * <p>{@link IActionContext} marks `credentials` as always present, but
 * unit fixtures may construct a partial context literal without it; the
 * cast through `unknown` makes a missing field surface as `undefined`
 * rather than throwing on a downstream property access.
 * @param ctx - Action context.
 * @returns JWT string (empty when the caller carries none).
 */
function tokenFromCreds(ctx: IActionContext): string {
  const raw = (ctx as unknown as { readonly credentials?: unknown }).credentials;
  const creds = (raw ?? {}) as IPayBoxCreds;
  return creds.otpLongTermToken ?? '';
}

/**
 * Resolve the long-term token — prefer the post-login session-context
 * value, then fall back to `creds.otpLongTermToken` for warm-creds
 * callers and test fixtures that may not have the session bus wired.
 * @param ctx - Action context.
 * @returns JWT string (empty when neither source carries one).
 */
function resolveToken(ctx: IActionContext): string {
  const session = readSessionContext(ctx);
  const fromSession = sessionString(session, 'token');
  if (fromSession.length > 0) return fromSession;
  return tokenFromCreds(ctx);
}

/**
 * Build the class-y `auth` envelope (signature is written by the
 * shape-level AES signer after dispatchStep hydrates the body).
 * <p>The spread comes first so a live identity field can never be
 * overwritten by a future addition to the defaults. The two sets do not
 * overlap today; ordering it this way means they still cannot if someone
 * adds an `access_token` default later.
 * @param ctx - Action context (used to read session-context + creds).
 * @returns Auth envelope object.
 */
export function buildAuthEnvelope(ctx: IActionContext): Record<string, string> {
  const session = readSessionContext(ctx);
  return {
    ...PAYBOX_AUTH_ENVELOPE_DEFAULTS,
    uuid: sessionString(session, 'deviceId16Hex'),
    uId: sessionString(session, 'uId'),
    access_token: resolveToken(ctx),
    signature: '',
  };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_AUTH_ENVELOPE_INTERNALS = { readSessionContext, resolveToken } as const;

/**
 * PayBox class-y `auth: { … }` body envelope — shared by EVERY
 * post-login call.
 *
 * <p>PayBox rejects any post-login request whose body omits this
 * envelope; see the `PipelineBankConfigPayBox.ts` header — "every
 * post-login call requires the class-y `auth: { … }` envelope". A body
 * carrying only the signer's `/auth/signature` pointer is answered with
 * HTTP 400, which `fallbackOnFail` then silently masks.
 *
 * <p>Extracted here so the balance (`/sync`) and transactions
 * (`/getUserHistory`) steps cannot drift apart: a step that builds its
 * body by hand is a step that will eventually forget the envelope.
 * `signature` is intentionally blank — the shape-level AES signer
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
 * Resolve the long-term token — prefer the post-login session-context
 * value, then fall back to `creds.otpLongTermToken` for warm-creds
 * callers and test fixtures that may not have the session bus wired.
 * @param ctx - Action context.
 * @returns JWT string (empty when neither source carries one).
 */
function resolveToken(ctx: IActionContext): string {
  const session = readSessionContext(ctx);
  const fromSession = typeof session.token === 'string' ? session.token : '';
  if (fromSession.length > 0) return fromSession;
  // The IActionContext type marks `credentials` as always present, but
  // unit fixtures may construct a partial context literal without it;
  // cast through `unknown` so a missing field surfaces as `undefined`
  // rather than throwing on a downstream property access.
  const raw = (ctx as unknown as { readonly credentials?: unknown }).credentials;
  const creds = (raw ?? {}) as IPayBoxCreds;
  return creds.otpLongTermToken ?? '';
}

/**
 * Build the class-y `auth` envelope (signature is written by the
 * shape-level AES signer after dispatchStep hydrates the body).
 * @param ctx - Action context (used to read session-context + creds).
 * @returns Auth envelope object.
 */
export function buildAuthEnvelope(ctx: IActionContext): Record<string, string> {
  const session = readSessionContext(ctx);
  const uId = typeof session.uId === 'string' ? session.uId : '';
  const deviceId = typeof session.deviceId16Hex === 'string' ? session.deviceId16Hex : '';
  return {
    uuid: deviceId,
    uId,
    access_token: resolveToken(ctx),
    appVer: PAYBOX_AUTH_ENVELOPE_DEFAULTS.appVer,
    type: PAYBOX_AUTH_ENVELOPE_DEFAULTS.type,
    os: PAYBOX_AUTH_ENVELOPE_DEFAULTS.os,
    signature: '',
  };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_AUTH_ENVELOPE_INTERNALS = { readSessionContext, resolveToken } as const;

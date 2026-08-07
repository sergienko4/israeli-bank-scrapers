/**
 * Flow-scoped reuse cache for `preHook` credential acquisitions.
 *
 * <p>Why this exists: a login chain may need the SAME delivered secret in more
 * than one step. Where a bank's login encrypts a one-time code into two
 * separate calls under different IVs, and each step scrubs the plaintext from
 * carry afterwards, the second step must re-acquire the digits. Without a
 * cache that re-acquisition is routed back to the caller — asking for a code
 * the bank delivered exactly once. (For the concrete step pair that motivated
 * this, see the relevant bank's step config under `Registry/Config/`.)
 *
 * <p>That is not merely a duplicate prompt. Real OTP transports are
 * single-shot by construction (an offset-confirmed chat bot, an SMS forwarder,
 * an app-push request removed once read), so the second request can never be
 * answered. It blocks until the caller's deadline expires and aborts the login
 * *after* authentication already succeeded.
 *
 * <p>Design notes:
 * <ul>
 *   <li>Keyed on `awaitCredsField`, so hooks awaiting <em>different</em>
 *       credentials never share an entry.</li>
 *   <li>Stores the in-flight promise, so an overlapping call awaits the same
 *       retrieval instead of starting a second one.</li>
 *   <li>Created per flow and discarded with it, so a retry after an invalid
 *       code still prompts for a genuinely new one.</li>
 *   <li>A failed acquisition is evicted, so a later attempt can prompt again
 *       rather than replaying the failure.</li>
 *   <li>Never logs the acquired value — these are one-time secrets.</li>
 * </ul>
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import type { IPreStepHook, PreHookReuse } from '../ConfigContracts/EnvelopeTypes.js';
import invokePreHookFn from './SmsOtpFlow.prehookInvoke.js';
import type { IPreHookAcquireArgs, IPreHookCache } from './SmsOtpFlow.types.js';

/** Reuse mode applied when a hook does not declare one. */
const DEFAULT_REUSE: PreHookReuse = 'per-flow';

/**
 * Create an empty flow-scoped preHook cache.
 * @returns A cache bound to a single login flow.
 */
function createPreHookCache(): IPreHookCache {
  return { pending: new Map(), counts: new Map() };
}

/**
 * Whether this hook shares one acquisition across the whole flow.
 *
 * <p>Defaults to `'per-flow'` — the semantics every caller already assumes.
 * A bank that genuinely delivers a distinct secret per step opts out with
 * `reuse: 'per-step'`.
 * @param hook - Pre-step hook config.
 * @returns True when the acquisition may be reused.
 */
function reusesAcrossFlow(hook: IPreStepHook): boolean {
  const mode = hook.reuse ?? DEFAULT_REUSE;
  return mode === 'per-flow';
}

/**
 * Record and return this field's 1-based invocation ordinal for the flow.
 * @param cache - Flow-scoped cache.
 * @param field - Credential field being awaited.
 * @returns The ordinal of this invocation.
 */
function nextInvocation(cache: IPreHookCache, field: string): number {
  const prior = cache.counts.get(field) ?? 0;
  const next = prior + 1;
  cache.counts.set(field, next);
  return next;
}

/**
 * Invoke the callback, memoise the in-flight promise, and evict on failure.
 * @param args - Cache + hook + bound callback bundle.
 * @returns Procedure with the acquired string.
 */
async function acquireAndMemoise(args: IPreHookAcquireArgs): Promise<Procedure<string>> {
  const field = args.hook.awaitCredsField;
  const invocation = nextInvocation(args.cache, field);
  const pending = invokePreHookFn({ fn: args.fn, hook: args.hook, invocation });
  args.cache.pending.set(field, pending);
  const settled = await pending;
  if (!isOk(settled)) args.cache.pending.delete(field);
  return settled;
}

/**
 * Acquire the hook's value, reusing this flow's prior acquisition when the
 * hook opts into flow-scoped reuse (the default).
 * @param args - Cache + hook + bound callback bundle.
 * @returns Procedure with the acquired string.
 */
async function acquirePreHookValue(args: IPreHookAcquireArgs): Promise<Procedure<string>> {
  if (!reusesAcrossFlow(args.hook)) {
    const invocation = nextInvocation(args.cache, args.hook.awaitCredsField);
    return invokePreHookFn({ fn: args.fn, hook: args.hook, invocation });
  }
  const existing = args.cache.pending.get(args.hook.awaitCredsField);
  if (existing === undefined) return acquireAndMemoise(args);
  return existing;
}

export { acquirePreHookValue, createPreHookCache, DEFAULT_REUSE, reusesAcrossFlow };

/**
 * Canary fixture for ESLint block 8g — BALANCE-RESOLVE QUARANTINE
 * INTEGRITY: every `await api.fetchPost(...)` / `await
 * api.fetchGet(...)` inside `Mediator/BalanceResolve/` MUST be wrapped
 * in a TryStatement. Without that wrap one bank account's network
 * error rejects the Promise.all loop and aborts every sibling fetch
 * (CR #264 finding #4 — Critical).
 *
 * This file deliberately violates the rule so the eslint canary
 * harness reports a non-zero error count.
 */

import type { Procedure } from '../Types/Procedure.js';

interface IFakeApi {
  fetchPost: (url: string) => Promise<Procedure<unknown>>;
}

/**
 * Forbidden pattern: bare await on api.fetchPost without try/catch.
 * @param api - Fake api.
 * @returns Promise.
 */
export async function leaksQuarantine(api: IFakeApi): Promise<Procedure<unknown>> {
  return await api.fetchPost('http://x');
}

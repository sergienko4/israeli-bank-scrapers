/**
 * Shared PayBox test factory — router-backed mock mediator plus the
 * action-context wrapper used by every PayBox scrape suite.
 *
 * Extracted from PayBoxShape.test.ts so the wallet-row quality suite
 * reuses one mediator definition instead of cloning it, per
 * `mocking-test-guidlines.md` ("prefer helper/builders/factories over
 * global setup"). All fixtures are synthetic — no real PII.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Synthetic PayBox user id surfaced as the wallet account number. */
export const FIXT_UID = 'pb-uid-fixture-1';
/** Synthetic 16-hex device id carried in the auth envelope. */
export const FIXT_DEVICE = 'fixt-device-pb-0001';
/** Synthetic bearer token carried in the auth envelope. */
export const FIXT_TOKEN = 'fixt-jwt-pb-0001';
/**
 * Synthetic phone (digits, international) whose `972-<national>` form
 * plus the key-exchange salt decrypts {@link FIXT_GETKEY_TSKEY} to
 * {@link FIXT_HMAC_KEY_HEX}. This vector is fabricated offline (never a
 * real number or captured secret) and is self-consistent by
 * construction — see HmacKeyExchange.test.ts, seed `972-500000000`.
 */
export const FIXT_PHONE = '972500000000';
/** Synthetic getKey ciphertext (base64 AES-256-CBC of the HMAC key). */
export const FIXT_GETKEY_TSKEY =
  'pxjyMHncrJcR805CNvcKpifVRcy+p0osdYW+it992A4/xCKyOx0SCVmN+KsTvW1HzTnKg+W66mFyNQPecjzdX7BRJUr+ib10Y3G9ddbNqxg=';
/** Synthetic getKey AES IV (hex). */
export const FIXT_GETKEY_TSIV = '0123456789abcdef0123456789abcdef';
/** Decrypted 32-byte HMAC key (hex) the synthetic fixture vector yields. */
export const FIXT_HMAC_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** PayBox session-context fixture used by extractAccountsFromSessionContext. */
export const PAYBOX_SESSION: Readonly<Record<string, unknown>> = Object.freeze({
  uId: FIXT_UID,
  deviceId16Hex: FIXT_DEVICE,
  token: FIXT_TOKEN,
});

/** Route per-call apiPost dispatch via the WK URL tag. */
const URL_TAG_TO_OP: Readonly<Record<string, 'bootstrap' | 'balance' | 'transactions'>> = {
  'data.getKey': 'bootstrap',
  'data.sync': 'balance',
  'data.getUserHistory': 'transactions',
  'data.virtualCardTranRequest': 'transactions',
};

/** Default getKey response — the live vector that decrypts to the HMAC key. */
const DEFAULT_GETKEY: Procedure<unknown> = succeed({
  content: { tsKey: FIXT_GETKEY_TSKEY, tsIv: FIXT_GETKEY_TSIV },
});

/** Per-operation ordered response queues consumed by the mock mediator. */
export type PayBoxRouter = Record<string, readonly Procedure<unknown>[]>;

/**
 * Build a router-backed mock mediator pre-seeded with PayBox session.
 * Auto-seeds a default getKey (bootstrap) response so suites that only
 * care about balance/transactions need not restate the key exchange.
 * The session-context is mutable so the getKey bootstrap's merge is
 * observable (mirrors the real mediator's read-merge-set contract).
 * @param router - Per-op ordered response queue.
 * @returns Mock mediator.
 */
export function makePayBoxBus(router: PayBoxRouter): IApiMediator {
  const queues: Record<string, Procedure<unknown>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  if (!('bootstrap' in queues)) queues.bootstrap = [DEFAULT_GETKEY];
  let session: Readonly<Record<string, unknown>> = PAYBOX_SESSION;
  /**
   * Shift the queue for an operation, surfacing a clear failure when empty.
   * @param op - Operation label.
   * @returns Next queued procedure.
   */
  async function route(op: string): Promise<Procedure<unknown>> {
    await Promise.resolve();
    const q = queues[op] ?? [];
    const head = q.shift();
    if (head) return head;
    return fail(ScraperErrorTypes.Generic, `no stub for op=${op}`);
  }
  const apiPost = jest.fn((urlTag: string) => route(URL_TAG_TO_OP[urlTag] ?? 'customer'));
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(route),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn((ctx: Readonly<Record<string, unknown>>): boolean => {
      session = ctx;
      return true;
    }),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => session),
  } as unknown as IApiMediator;
}

/**
 * Build an IActionContext wired with the PayBox bus, injecting an explicit
 * phone string. Lets suites exercise both the canonical digits-only form and
 * the `972-<national>` wire form the ApiDirectCall edge leaves on ctx.
 * @param bus - Mock mediator.
 * @param phone - Phone digits (canonical or wire form) to seed on credentials.
 * @returns Action context.
 */
export function ctxOfWithPhone(bus: IApiMediator, phone: string): IActionContext {
  const overrides: Partial<IPipelineContext> = { apiMediator: some(bus) };
  const base = makeMockContext(overrides);
  const credentials = { phoneNumber: phone } as unknown as typeof base.credentials;
  return { ...base, credentials } as unknown as IActionContext;
}

/**
 * Build an IActionContext wired with the PayBox bus. Injects the live
 * fixture phone so the getKey bootstrap can derive its AES key.
 * @param bus - Mock mediator.
 * @returns Action context.
 */
export function ctxOf(bus: IApiMediator): IActionContext {
  return ctxOfWithPhone(bus, FIXT_PHONE);
}

/**
 * Build an IActionContext whose credentials carry NO phoneNumber, so the
 * getKey bootstrap's phone read falls back to empty and key derivation
 * fails closed. Exercises the missing-credential edge.
 * @param bus - Mock mediator.
 * @returns Action context with credential-less phone.
 */
export function ctxOfNoPhone(bus: IApiMediator): IActionContext {
  const base = makeMockContext({ apiMediator: some(bus) });
  return { ...base, credentials: {} } as unknown as IActionContext;
}

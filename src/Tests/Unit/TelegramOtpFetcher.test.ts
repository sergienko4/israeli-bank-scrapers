/**
 * Unit tests for {@link fetchOtpFromTelegram} — verify the
 * 4-tier validation, the long-poll loop, the regex match
 * semantics, and the acknowledge-by-offset advancement.
 *
 * No real network calls — `global.fetch` is replaced with a
 * jest.fn for every test and restored after.
 */

import { jest } from '@jest/globals';

import { fetchOtpFromTelegram, type ITelegramFetchArgs } from '../E2eReal/TelegramOtpFetcher.js';

/** Minimal pino-shaped logger for tests. */
interface ITestLogger {
  readonly trace: jest.Mock;
  readonly debug: jest.Mock;
  readonly info: jest.Mock;
  readonly warn: jest.Mock;
  readonly error: jest.Mock;
}

/**
 * Build a fresh stub logger.
 * @returns Logger with every method as `jest.fn()`.
 */
function makeStubLogger(): ITestLogger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Captures `fetch` calls per test. */
let fetchSpy: jest.Mock;
let originalFetch: typeof fetch | undefined;

/**
 * Build a Response-shaped stub.
 * @param body - Body to expose via `json()`.
 * @returns Response stub.
 */
function makeFetchResponse(body: Record<string, unknown>): Response {
  /**
   * Body accessor — returns the queued payload synchronously
   * wrapped in a resolved promise (matches the Response.json
   * contract without a real await).
   * @returns The body.
   */
  const json = (): Promise<unknown> => Promise.resolve(body);
  return { ok: true, json } as unknown as Response;
}

/**
 * Replace `global.fetch` with a queue-driven jest mock that
 * returns the supplied responses in order. Subsequent calls
 * after the queue empties resolve with empty `result`.
 *
 * @param responses - Ordered fetch resolutions.
 * @returns The installed mock — caller may inspect `mock.calls`.
 */
function installFetch(responses: readonly Record<string, unknown>[]): jest.Mock {
  let cursor = 0;
  /**
   * Mock fetch implementation closing over `cursor` + `responses`.
   * @returns The queued response or a default empty-result envelope.
   */
  const impl = (): Promise<Response> => {
    const body = cursor < responses.length ? responses[cursor] : { ok: true, result: [] };
    cursor += 1;
    const response = makeFetchResponse(body);
    return Promise.resolve(response);
  };
  fetchSpy = jest.fn(impl);
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy;
  return fetchSpy;
}

/**
 * Restore the real `global.fetch`.
 * @returns The same fetchSpy reference (now uninstalled) — useful
 *   for callers that want to assert call counts after restore.
 */
function restoreFetch(): jest.Mock {
  if (originalFetch !== undefined) {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
  return fetchSpy;
}

/**
 * Build a baseline args bundle for the fetcher.
 * @param overrides - Per-test overrides.
 * @returns Args.
 */
function makeArgs(overrides?: Partial<ITelegramFetchArgs>): ITelegramFetchArgs {
  const log = makeStubLogger();
  return {
    botToken: 'TEST_TOKEN',
    chatId: '-100456789',
    bankRegex: /Beinleumi\D*(\d{6})/,
    timeoutMs: 2_000,
    log,
    ...overrides,
  } as ITelegramFetchArgs;
}

afterEach((): void => {
  restoreFetch();
  jest.clearAllMocks();
});

describe('fetchOtpFromTelegram', () => {
  it('TF-1 happy path — resolves with the captured digits', async () => {
    installFetch([
      // 1) Initial offset probe: returns the highest-known update_id
      //    as the per-fetcher minUpdateId floor (read-only — does not
      //    confirm).
      { ok: true, result: [{ update_id: 99 }] },
      // 2) First poll cycle returns the OTP. update_id=100 > 99 → match.
      {
        ok: true,
        result: [
          {
            update_id: 100,
            message: { chat: { id: -100456789 }, text: 'Beinleumi auth: 654321' },
          },
        ],
      },
      // No acknowledge step — fetcher never advances the bot's
      // confirmed offset (parallel-safety invariant).
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('654321');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('TF-2 timeout — returns false when no match within budget', async () => {
    installFetch([
      { ok: true, result: [{ update_id: 50 }] },
      // every subsequent poll yields no match
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-3 multi-match — picks the latest update_id', async () => {
    installFetch([
      { ok: true, result: [{ update_id: 199 }] },
      {
        ok: true,
        result: [
          {
            update_id: 200,
            message: { chat: { id: -100456789 }, text: 'Beinleumi: 111111' },
          },
          {
            update_id: 201,
            message: { chat: { id: -100456789 }, text: 'Beinleumi: 222222' },
          },
        ],
      },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('222222');
  });

  it('TF-4 read-only-offset — fetcher NEVER calls getUpdates with positive offset', async () => {
    // Parallel-safety invariant: confirmed offset must stay frozen.
    // Asserts every URL the fetcher constructs uses either offset=-1
    // (initial probe) or offset=-100 (poll window). A positive offset
    // would advance Telegram's confirmed cursor and purge another
    // parallel fetcher's pending OTP.
    installFetch([
      { ok: true, result: [{ update_id: 9 }] },
      {
        ok: true,
        result: [
          {
            update_id: 10,
            message: { chat: { id: -100456789 }, text: 'Beinleumi auth: 333333' },
          },
        ],
      },
    ]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    const calls: readonly unknown[][] = fetchSpy.mock.calls;
    const allowedOffsets: readonly string[] = ['offset=-1', 'offset=-100'];
    for (const callArgs of calls) {
      const firstArg = callArgs[0];
      const url = typeof firstArg === 'string' ? firstArg : '';
      const isAllowed = allowedOffsets.some((token): boolean => url.includes(token));
      expect(isAllowed).toBe(true);
    }
  });

  it('TF-4b strict-floor — rejects updates with update_id <= minUpdateId', async () => {
    // The fetcher's per-instance minUpdateId floor MUST exclude any
    // update that was already in the chat at fetcher start. Initial
    // probe returns update_id=500; the poll returns update_id=500
    // (same one — pre-existing in chat) which MUST be filtered out
    // even though it matches the regex.
    installFetch([
      { ok: true, result: [{ update_id: 500 }] },
      {
        ok: true,
        result: [
          {
            update_id: 500,
            message: { chat: { id: -100456789 }, text: 'Beinleumi: 999999' },
          },
        ],
      },
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-5 missing token — returns false synchronously, no network call', async () => {
    installFetch([]);
    const args = makeArgs({ botToken: '' });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5b missing chatId — returns false synchronously', async () => {
    installFetch([]);
    const args = makeArgs({ chatId: '' });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5c invalid regex (no capture group) — returns false synchronously', async () => {
    installFetch([]);
    const args = makeArgs({ bankRegex: /Beinleumi/ });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5d invalid timeout (zero) — returns false synchronously', async () => {
    installFetch([]);
    const args = makeArgs({ timeoutMs: 0 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-6 wrong-chat — returns false; never picks the off-chat OTP', async () => {
    installFetch([
      { ok: true, result: [{ update_id: 1 }] },
      {
        ok: true,
        result: [
          {
            update_id: 2,
            message: { chat: { id: -999999 }, text: 'Beinleumi 444444' },
          },
        ],
      },
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });
});

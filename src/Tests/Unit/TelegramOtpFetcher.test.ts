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

/** Mock fetch responses — separate queues per Telegram endpoint. */
interface IFetchQueues {
  /** Responses for `sendMessage` calls (in order). */
  readonly sendMessage: readonly Record<string, unknown>[];
  /** Responses for `getUpdates` calls (in order). */
  readonly getUpdates: readonly Record<string, unknown>[];
}

/**
 * Default `sendMessage` response — assigns message_id 5000 so reply
 * fixtures use that id.
 */
const DEFAULT_PROMPT_ID = 5000;

/**
 * Build a default sendMessage success response.
 * @returns Telegram-shaped sendMessage success.
 */
function defaultPromptResponse(): Record<string, unknown> {
  return { ok: true, result: { message_id: DEFAULT_PROMPT_ID } };
}

/**
 * Replace `global.fetch` with a queue-driven mock that routes by
 * URL: `sendMessage` URLs pull from `queues.sendMessage`,
 * `getUpdates` URLs pull from `queues.getUpdates`. Both default
 * to a permissive empty-result envelope after their queues drain.
 *
 * @param queues - Ordered fetch resolutions per endpoint.
 * @returns The installed mock — caller may inspect `mock.calls`.
 */
function installFetch(queues: IFetchQueues): jest.Mock {
  let sendCursor = 0;
  let getCursor = 0;
  /**
   * Mock fetch implementation routes by URL pattern.
   * @param url - Telegram API URL.
   * @returns Response.
   */
  const impl = (url: unknown): Promise<Response> => {
    const u = typeof url === 'string' ? url : '';
    let body: Record<string, unknown>;
    if (u.includes('/sendMessage')) {
      body =
        sendCursor < queues.sendMessage.length
          ? queues.sendMessage[sendCursor]
          : defaultPromptResponse();
      sendCursor += 1;
    } else {
      body =
        getCursor < queues.getUpdates.length
          ? queues.getUpdates[getCursor]
          : { ok: true, result: [] };
      getCursor += 1;
    }
    const response = makeFetchResponse(body);
    return Promise.resolve(response);
  };
  fetchSpy = jest.fn(impl);
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy;
  return fetchSpy;
}

/**
 * Convenience: install fetch with default sendMessage success +
 * the supplied getUpdates queue.
 * @param getUpdatesQueue - Ordered getUpdates responses.
 * @returns The installed mock.
 */
function installFetchWithDefaultPrompt(
  getUpdatesQueue: readonly Record<string, unknown>[],
): jest.Mock {
  return installFetch({
    sendMessage: [defaultPromptResponse()],
    getUpdates: getUpdatesQueue,
  });
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
    bankName: 'Beinleumi',
    bankRegex: /(\d{4,8})/,
    timeoutMs: 2_000,
    log,
    ...overrides,
  } as ITelegramFetchArgs;
}

/**
 * Build a Telegram update payload containing a reply to the bot's
 * prompt. Tests use this to simulate the user pressing "Reply" in
 * Telegram and typing the OTP digits.
 * @param updateId - Update id (must be > floor in tests).
 * @param text - User's reply text (typically just digits).
 * @param replyToId - The bot's prompt message_id (defaults to
 *   DEFAULT_PROMPT_ID).
 * @returns Update fixture.
 */
function makeReplyUpdate(
  updateId: number,
  text: string,
  replyToId: number = DEFAULT_PROMPT_ID,
): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      chat: { id: -100456789 },
      text,
      date: 1715200000,
      reply_to_message: { message_id: replyToId },
    },
  };
}

afterEach((): void => {
  restoreFetch();
  jest.clearAllMocks();
});

describe('fetchOtpFromTelegram', () => {
  it('TF-1 happy path — sends prompt then resolves on the user reply', async () => {
    installFetchWithDefaultPrompt([
      // 1) Initial offset probe: returns the highest-known update_id.
      { ok: true, result: [{ update_id: 99 }] },
      // 2) First poll cycle returns the user's reply to our prompt.
      { ok: true, result: [makeReplyUpdate(100, '654321')] },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('654321');
    // sendMessage + initial-offset probe + 1 poll cycle = 3 calls.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('TF-2 timeout — returns false when no reply within budget', async () => {
    installFetchWithDefaultPrompt([{ ok: true, result: [{ update_id: 50 }] }]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-3 multi-reply — picks the latest update_id', async () => {
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 199 }] },
      {
        ok: true,
        result: [makeReplyUpdate(200, '111111'), makeReplyUpdate(201, '222222')],
      },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('222222');
  });

  it('TF-4 read-only-offset — getUpdates calls only use offset=-1 or offset=-100', async () => {
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 9 }] },
      { ok: true, result: [makeReplyUpdate(10, '333333')] },
    ]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    const calls: readonly unknown[][] = fetchSpy.mock.calls;
    const allowedOffsets: readonly string[] = ['offset=-1', 'offset=-100'];
    for (const callArgs of calls) {
      const firstArg = callArgs[0];
      const url = typeof firstArg === 'string' ? firstArg : '';
      // sendMessage URL has no offset; only check getUpdates URLs.
      if (!url.includes('/getUpdates')) continue;
      const isAllowed = allowedOffsets.some((token): boolean => url.includes(token));
      expect(isAllowed).toBe(true);
    }
  });

  it('TF-4b strict-floor — rejects replies with update_id <= minUpdateId', async () => {
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 500 }] },
      // Update with update_id=500 (same as floor) MUST be filtered.
      { ok: true, result: [makeReplyUpdate(500, '999999')] },
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-4c reply-scoped — rejects messages that are NOT replies to our prompt', async () => {
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 1 }] },
      // A digits-only message in the chat that's NOT a reply (no
      // reply_to_message field). Must be filtered to preserve
      // parallel-safety: in a multi-fetcher scenario, only direct
      // replies to our prompt qualify.
      {
        ok: true,
        result: [
          {
            update_id: 2,
            message: {
              chat: { id: -100456789 },
              text: '777777',
              date: 1715200000,
            },
          },
        ],
      },
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-4d cross-prompt — rejects replies to a DIFFERENT prompt id', async () => {
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 1 }] },
      // Reply to message_id 9999 (NOT our prompt 5000) must be ignored.
      { ok: true, result: [makeReplyUpdate(2, '888888', 9999)] },
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-5 missing token — returns false synchronously, no network call', async () => {
    installFetchWithDefaultPrompt([]);
    const args = makeArgs({ botToken: '' });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5b missing chatId — returns false synchronously', async () => {
    installFetchWithDefaultPrompt([]);
    const args = makeArgs({ chatId: '' });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5b2 missing bankName — returns false synchronously', async () => {
    installFetchWithDefaultPrompt([]);
    const args = makeArgs({ bankName: '' });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5c invalid regex (no capture group) — returns false synchronously', async () => {
    installFetchWithDefaultPrompt([]);
    const args = makeArgs({ bankRegex: /Beinleumi/ });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-5d invalid timeout (zero) — returns false synchronously', async () => {
    installFetchWithDefaultPrompt([]);
    const args = makeArgs({ timeoutMs: 0 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TF-6 wrong-chat — returns false; never picks the off-chat reply', async () => {
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 1 }] },
      {
        ok: true,
        result: [
          {
            update_id: 2,
            message: {
              chat: { id: -999999 },
              text: '444444',
              date: 1715200000,
              reply_to_message: { message_id: DEFAULT_PROMPT_ID },
            },
          },
        ],
      },
    ]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-7 prompt-failed — returns false when sendMessage fails', async () => {
    // Telegram returns ok:false on sendMessage → fetcher cannot
    // proceed (no message_id to scope replies against), aborts.
    installFetch({
      sendMessage: [{ ok: false, description: 'bad token' }],
      getUpdates: [],
    });
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    // sendMessage was attempted; no getUpdates calls made.
    const allCalls: readonly unknown[][] = fetchSpy.mock.calls;
    const sendCount = allCalls.filter((c): boolean => {
      const u = typeof c[0] === 'string' ? c[0] : '';
      return u.includes('/sendMessage');
    }).length;
    const getCount = allCalls.filter((c): boolean => {
      const u = typeof c[0] === 'string' ? c[0] : '';
      return u.includes('/getUpdates');
    }).length;
    expect(sendCount).toBe(1);
    expect(getCount).toBe(0);
  });
});

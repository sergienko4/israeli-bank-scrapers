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
 * Custom error raised by {@link installFetch} when the fetcher
 * targets an endpoint outside the two we explicitly mock
 * (`/sendMessage` + `/getUpdates`). A custom class — instead of
 * `throw new Error(...)` — satisfies the project's restriction
 * on `Error` literals in tests.
 */
class InstallFetchUnexpectedEndpointError extends Error {
  /**
   * Build the unexpected-endpoint error.
   * @param url - The offending URL we received.
   */
  constructor(url: string) {
    super(
      `installFetch: unexpected Telegram endpoint — only /sendMessage and /getUpdates are mocked. URL: ${url}`,
    );
    this.name = 'InstallFetchUnexpectedEndpointError';
  }
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
   * Mock fetch implementation routes by URL pattern. The fetcher
   * is expected to use ONLY two Telegram endpoints — `/sendMessage`
   * (prompt + ack) and `/getUpdates` (poll) — so any other URL is
   * a test bug or an unintended new fetcher path. Throwing here
   * fail-fasts those scenarios instead of letting them fall into a
   * default queue and masking the real call shape.
   *
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
    } else if (u.includes('/getUpdates')) {
      body =
        getCursor < queues.getUpdates.length
          ? queues.getUpdates[getCursor]
          : { ok: true, result: [] };
      getCursor += 1;
    } else {
      throw new InstallFetchUnexpectedEndpointError(u);
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

/** Args tuple of a single fetch call (URL + RequestInit). */
type IFetchCallArgs = readonly [unknown, unknown?];

/** A typed view over `fetchSpy.mock.calls` — list of call-arg tuples. */
type FetchCalls = readonly IFetchCallArgs[];

/**
 * Read `fetchSpy.mock.calls` as a typed call-list. Encapsulates the
 * jest typing gap (`mock.calls` is `unknown[][]` at the boundary)
 * so individual tests don't need to repeat the same cast.
 *
 * @param spy - The installed fetch spy.
 * @returns Typed call list.
 */
function readFetchCalls(spy: jest.Mock): FetchCalls {
  return spy.mock.calls as FetchCalls;
}

/**
 * Extract the URL string from a single fetch-call args tuple.
 *
 * @param call - One row of `fetchSpy.mock.calls`.
 * @returns URL string, or empty string when the call wasn't a
 *   string-URL fetch (i.e. `Request` object form, never used here).
 */
function getCallUrl(call: IFetchCallArgs): string {
  const url = call[0];
  return typeof url === 'string' ? url : '';
}

/**
 * Filter the spy's calls down to those targeting `/sendMessage`.
 * @param spy - The installed fetch spy.
 * @returns Subset of calls whose URL contains `/sendMessage`.
 */
function getSendMessageCalls(spy: jest.Mock): FetchCalls {
  const all = readFetchCalls(spy);
  return all.filter((call: IFetchCallArgs): boolean => {
    const url = getCallUrl(call);
    return url.includes('/sendMessage');
  });
}

/**
 * Parse the JSON body of a fetch RequestInit. Tests guard against
 * missing-call cases by asserting `length` first, so this helper
 * trusts the call exists.
 *
 * @param call - The fetch-call args (URL + RequestInit).
 * @returns Decoded JSON body as a typed record.
 */
function parseFetchBody(call: IFetchCallArgs): Record<string, unknown> {
  const initSlot = call[1];
  const initShape = initSlot as { body?: string };
  const raw = initShape.body ?? '{}';
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed;
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
    // floor probe + sendMessage + 1 poll cycle + ack-on-match = 4 calls.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
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

  it('TF-4 positive-offset polling — readInitial uses offset=-1, pollOnce uses offset=minUpdateId+1', async () => {
    // Probe returns update_id=9 → fetcher's minUpdateId=9 → all
    // pollOnce calls MUST use offset=10. The negative-offset window
    // (`offset=-N`) was the root cause of the Beinleumi CI miss
    // (CI run 25690651046): with negative offset, Telegram does NOT
    // short-circuit the long-poll on new data, so a reply landing
    // mid-cycle stays unseen until the next tick. Positive offset
    // fixes that — see TelegramOtpFetcher.ts top-of-file JSDoc.
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 9 }] },
      { ok: true, result: [makeReplyUpdate(10, '333333')] },
    ]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    const getUpdatesUrls = readFetchCalls(fetchSpy)
      .map(getCallUrl)
      .filter((u): boolean => u.includes('/getUpdates'));
    // Exactly two getUpdates calls expected: readInitial + 1 poll.
    expect(getUpdatesUrls).toHaveLength(2);
    expect(getUpdatesUrls[0]).toContain('offset=-1');
    expect(getUpdatesUrls[1]).toContain('offset=10');
    // No call uses the legacy negative-N window.
    const negativeOffsets = getUpdatesUrls.filter((u): boolean => /offset=-\d{2,}/.test(u));
    expect(negativeOffsets).toHaveLength(0);
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

  /**
   * Skip-reason table — TF-5 .. TF-5d share the assertion (returns
   * false synchronously, never touches the network); only ONE arg
   * override differs per row. Adding a new skip reason means a
   * single row in `SKIP_REASON_SCENARIOS`, not a new test block.
   */
  interface ISkipReasonScenario {
    readonly label: string;
    readonly overrides: Partial<ITelegramFetchArgs>;
  }

  const skipReasonScenarios: readonly ISkipReasonScenario[] = [
    { label: 'TF-5 missing token', overrides: { botToken: '' } },
    { label: 'TF-5b missing chatId', overrides: { chatId: '' } },
    { label: 'TF-5b2 missing bankName', overrides: { bankName: '' } },
    { label: 'TF-5b3 non-numeric chatId (@channel form)', overrides: { chatId: '@some_channel' } },
    { label: 'TF-5c invalid regex (no capture group)', overrides: { bankRegex: /Beinleumi/ } },
    { label: 'TF-5d invalid timeout (zero)', overrides: { timeoutMs: 0 } },
  ];

  skipReasonScenarios.map((sc): true => {
    it(`${sc.label} — returns false synchronously, no network call`, async () => {
      installFetchWithDefaultPrompt([]);
      const args = makeArgs(sc.overrides);
      const result = await fetchOtpFromTelegram(args);
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
    return true;
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
    // The pre-prompt floor probe still runs because the
    // race-free order captures `minUpdateId` BEFORE sending the
    // prompt (TF-8).
    installFetch({
      sendMessage: [{ ok: false, description: 'bad token' }],
      getUpdates: [{ ok: true, result: [{ update_id: 1 }] }],
    });
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
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
    // Floor probe (1) + zero poll cycles (sendMessage failed before
    // poll loop entered).
    expect(getCount).toBe(1);
  });

  it('TF-8 race-free order — floor probe runs BEFORE sendMessage', async () => {
    // Regression: with the OLD order (sendMessage → floor →
    // poll), a fast SMS-to-Telegram forwarder could land its
    // reply between sendMessage and the floor probe. The probe
    // would then return that very reply's update_id as the
    // floor, and the strict-greater filter (`update_id >
    // minUpdateId`) would reject the reply we are waiting for.
    // The fix is to capture the floor FIRST: any reply to our
    // prompt is then guaranteed to have `update_id > floor` by
    // construction. Per-prompt isolation comes from the
    // `reply_to_message.message_id` filter (TF-4d), not from
    // this floor.
    installFetchWithDefaultPrompt([
      // Floor probe — pre-prompt snapshot of the chat.
      { ok: true, result: [{ update_id: 1000 }] },
      // First poll cycle — forwarder's reply landed at update_id
      // 1001 (which would have been the floor under the old
      // order, causing the strict-greater filter to reject it).
      { ok: true, result: [makeReplyUpdate(1001, '424242')] },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('424242');
    const calls = readFetchCalls(fetchSpy);
    const firstCall = calls[0];
    const secondCall = calls[1];
    const firstUrl = getCallUrl(firstCall);
    const secondUrl = getCallUrl(secondCall);
    expect(firstUrl).toContain('/getUpdates');
    expect(secondUrl).toContain('/sendMessage');
  });

  it('TF-9 ack on match — sends a confirmation reply scoped to the prompt', async () => {
    // UX: after a successful match the bot acknowledges receipt
    // so the user knows their reply was consumed and the scrape
    // is proceeding. Best-effort — failures must not affect the
    // OTP flow (covered by TF-9b).
    installFetchWithDefaultPrompt([
      { ok: true, result: [{ update_id: 1 }] },
      { ok: true, result: [makeReplyUpdate(2, '424242')] },
    ]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    const sendMessageCalls = getSendMessageCalls(fetchSpy);
    // 1 prompt + 1 ack = 2 sendMessage calls.
    expect(sendMessageCalls.length).toBe(2);
    const ackCall = sendMessageCalls[1];
    const ackBody = parseFetchBody(ackCall);
    expect(ackBody.reply_to_message_id).toBe(DEFAULT_PROMPT_ID);
    const ackText = typeof ackBody.text === 'string' ? ackBody.text : '';
    expect(ackText).toMatch(/Beinleumi/);
  });

  it('TF-10 ack on timeout — sends a "no reply" message scoped to the prompt', async () => {
    installFetchWithDefaultPrompt([{ ok: true, result: [{ update_id: 50 }] }]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    const sendMessageCalls = getSendMessageCalls(fetchSpy);
    // 1 prompt + 1 timeout-ack.
    expect(sendMessageCalls.length).toBe(2);
    const ackCall = sendMessageCalls[1];
    const ackBody = parseFetchBody(ackCall);
    expect(ackBody.reply_to_message_id).toBe(DEFAULT_PROMPT_ID);
    const ackText = typeof ackBody.text === 'string' ? ackBody.text : '';
    expect(ackText).toMatch(/no reply/);
  });
});

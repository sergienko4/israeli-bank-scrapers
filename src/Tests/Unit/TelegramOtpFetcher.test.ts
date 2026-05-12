/**
 * Unit tests for {@link fetchOtpFromTelegram} — verify the
 * 4-tier validation, the non-destructive `offset=0` long-poll
 * loop, the regex match semantics, and the
 * `reply_to_message.message_id`-scoped attribution (A.fix-2).
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
 * Filter the spy's calls down to those targeting `/getUpdates`.
 * Symmetric helper to {@link getSendMessageCalls}; tests use both to
 * avoid re-deriving the URL-filter inline (per CodeRabbit PR #215
 * review on TF-7).
 * @param spy - The installed fetch spy.
 * @returns Subset of calls whose URL contains `/getUpdates`.
 */
function getGetUpdatesCalls(spy: jest.Mock): FetchCalls {
  const all = readFetchCalls(spy);
  return all.filter((call: IFetchCallArgs): boolean => {
    const url = getCallUrl(call);
    return url.includes('/getUpdates');
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
 * Default fixture timestamp — a fixed 2024-05 epoch that
 * {@link pruneOldUpdates} treats as stale, exercising the
 * GC-confirm branch in TF-11.
 */
const STALE_FIXTURE_DATE_SEC = 1_715_200_000;

/**
 * Build a Telegram update payload containing a reply to the bot's
 * prompt. Tests use this to simulate the user pressing "Reply" in
 * Telegram and typing the OTP digits.
 * @param updateId - Update id (must be > floor in tests).
 * @param text - User's reply text (typically just digits).
 * @param replyToId - The bot's prompt message_id (defaults to
 *   DEFAULT_PROMPT_ID).
 * @returns Update fixture with the stale default date.
 */
function makeReplyUpdate(
  updateId: number,
  text: string,
  replyToId: number = DEFAULT_PROMPT_ID,
): Record<string, unknown> {
  return makeReplyUpdateAt({ updateId, text, replyToId, dateSec: STALE_FIXTURE_DATE_SEC });
}

/** Bundle for {@link makeReplyUpdateAt}. */
interface IMakeReplyUpdateAtArgs {
  readonly updateId: number;
  readonly text: string;
  readonly replyToId: number;
  readonly dateSec: number;
}

/**
 * Lower-level fixture builder used when the date matters — e.g.
 * TELEGRAM-OFFSET-001 needs RECENT updates so the detached
 * `pruneOldUpdates` GC stays on its early-return branch and never
 * advances Telegram's cursor on the cross-fetcher fixture.
 * @param args - All update knobs as a bundle (avoids the project's
 *   3-param ceiling for the date case).
 * @returns Update fixture.
 */
function makeReplyUpdateAt(args: IMakeReplyUpdateAtArgs): Record<string, unknown> {
  return {
    update_id: args.updateId,
    message: {
      chat: { id: -100456789 },
      text: args.text,
      date: args.dateSec,
      reply_to_message: { message_id: args.replyToId },
    },
  };
}

/**
 * Drain microtasks until the spy has been invoked at least
 * `targetCalls` times, or `maxTicks` ticks have elapsed. Tests need
 * this because the fetcher detaches the post-match ack and the
 * post-match GC pass (per `fetchOtpFromTelegram`'s
 * {@link detachSideEffect}) so the captured OTP can be returned to
 * the caller without waiting on observability/housekeeping HTTP
 * roundtrips. The detached promises resolve on subsequent
 * microtask ticks; chaining `Promise.resolve().then(...)`
 * recursively yields one tick per recursion without tripping
 * `no-await-in-loop`.
 *
 * @param spy - The installed fetch spy.
 * @param targetCalls - Minimum invocation count to wait for.
 * @param maxTicks - Recursion ceiling — guards against a hung detach.
 * @returns True when the count reaches the target, false on ceiling.
 */
function flushDetachedSideEffects(
  spy: jest.Mock,
  targetCalls: number,
  maxTicks = 50,
): Promise<boolean> {
  const isReached = spy.mock.calls.length >= targetCalls;
  if (isReached) return Promise.resolve(true);
  if (maxTicks <= 0) return Promise.resolve(false);
  return Promise.resolve().then(
    (): Promise<boolean> => flushDetachedSideEffects(spy, targetCalls, maxTicks - 1),
  );
}

afterEach(async (): Promise<void> => {
  // Drain any detached ack/GC chains BEFORE tearing the fetch mock
  // down. Otherwise late-firing detached promises would hit the
  // restored `globalThis.fetch` (a real network call to Telegram in
  // local dev / jest worker) and surface as cross-test pollution.
  // `Number.MAX_SAFE_INTEGER` is unreachable so the helper always
  // exhausts `maxTicks`; the boolean result is irrelevant here.
  await flushDetachedSideEffects(fetchSpy, Number.MAX_SAFE_INTEGER, 20);
  restoreFetch();
  jest.clearAllMocks();
});

describe('fetchOtpFromTelegram', () => {
  it('TF-1 happy path — sends prompt then resolves on the user reply', async () => {
    installFetchWithDefaultPrompt([
      // First poll cycle returns the user's reply to our prompt.
      { ok: true, result: [makeReplyUpdate(100, '654321')] },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('654321');
    // sendMessage + 1 poll cycle = 2 awaited calls. Ack + GC inspect
    // are DETACHED so the caller gets the code immediately; flush
    // microtasks before the call-count assertion. GC inspect falls
    // through the mock's empty default → pruneOldUpdates returns
    // early (no confirm). Expected total: prompt + poll + ack + GC
    // inspect = 4.
    const didReachFourCalls = await flushDetachedSideEffects(fetchSpy, 4);
    expect(didReachFourCalls).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('TF-2 timeout — returns false when no reply within budget', async () => {
    installFetchWithDefaultPrompt([{ ok: true, result: [{ update_id: 50 }] }]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
  });

  it('TF-3 multi-reply — newest matching reply wins on tiebreak', async () => {
    // After A.fix-2 the selection rule is: first match (newest-first
    // traversal via compareUpdateIdDesc) whose reply_to_message.
    // message_id === promptMessageId. `update_id` is the tiebreak
    // ordering key, not the selection criterion.
    installFetchWithDefaultPrompt([
      {
        ok: true,
        result: [makeReplyUpdate(200, '111111'), makeReplyUpdate(201, '222222')],
      },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('222222');
  });

  it('TF-4 non-destructive offset=0 — every getUpdates uses offset=0, no probe call', async () => {
    // A.fix-2 contract: every poll call uses Telegram's documented
    // non-destructive offset=0 (returns earliest unconfirmed without
    // advancing the cursor). NO initial probe; the fetcher emits
    // sendMessage first, then enters the poll loop. The previous
    // design (`readInitialUpdateId` with offset=-1 + per-cycle
    // `offset=minUpdateId+1`) was replaced 2026-05-12 because
    // `offset=-1` is documented to "forget all previous updates",
    // which purged parallel-CI-matrix fetchers' pending replies.
    // See top-of-file JSDoc + telegram-m5-and-final-cleanup
    // spec.txt §"Phase A.fix-2".
    installFetchWithDefaultPrompt([{ ok: true, result: [makeReplyUpdate(10, '333333')] }]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    // GC inspect is detached post-match; flush so the inspect call is
    // captured before we read the spy. Total: prompt + poll + ack +
    // GC inspect = 4 (no confirm — mock default returns empty queue).
    await flushDetachedSideEffects(fetchSpy, 4);
    const getUpdatesUrls = getGetUpdatesCalls(fetchSpy).map(getCallUrl);
    // 1 poll cycle + 1 GC inspect (pruneOldUpdates post-match) = 2 calls.
    expect(getUpdatesUrls).toHaveLength(2);
    const isAllOffsetZero = getUpdatesUrls.every((u: string): boolean => /offset=0(?!\d)/.test(u));
    expect(isAllOffsetZero).toBe(true);
    const negativeOffsets = getUpdatesUrls.filter((u: string): boolean => /offset=-\d+/.test(u));
    expect(negativeOffsets).toHaveLength(0);
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

  it('TELEGRAM-OFFSET-001 non-destructive offset=0 polling — picks own reply AND leaves the other bank in the queue', async () => {
    // A.fix-2 contract per spec.txt §"Phase A.fix-2 — Telegram
    // non-destructive `getUpdates`": every getUpdates call uses
    // offset=0 (Telegram-documented non-destructive read) so multiple
    // parallel fetchers (CI matrix runners) safely share the bot's
    // queue. Each fetcher filters by reply_to_message.message_id and
    // picks ONLY its own reply. NO call uses offset=-1 (the documented
    // purge trigger that caused the cross-fetcher Beinleumi-during-
    // Hapoalim symptom 2026-05-12).
    //
    // Per CodeRabbit PR #226 review on this test: also assert the
    // CROSS-FETCHER invariant — after the first fetcher returns,
    // an independent second poll of the same queue still observes
    // the other bank's reply (`reply_to_message.message_id=9999`).
    // Without this assertion the test passes even against a hypothetical
    // implementation that destructively confirmed `match.update_id+1`,
    // which is the exact regression class A.fix-2 prevents. Recent
    // dates keep `pruneOldUpdates` on its early-return branch so the
    // detached GC never advances the cursor on this fixture.
    const recentDateSec = Math.floor(Date.now() / 1000) - 60;
    const otherBankReply = makeReplyUpdateAt({
      updateId: 50,
      text: '9876',
      replyToId: 9999,
      dateSec: recentDateSec,
    });
    const ourReply = makeReplyUpdateAt({
      updateId: 51,
      text: '1234',
      replyToId: DEFAULT_PROMPT_ID,
      dateSec: recentDateSec,
    });
    const sharedQueue = [otherBankReply, ourReply];
    installFetchWithDefaultPrompt([
      // Slot 1 — fetcher's poll cycle.
      { ok: true, result: sharedQueue },
      // Slot 2 — detached pruneOldUpdates inspect call.
      { ok: true, result: sharedQueue },
      // Slot 3 — simulated second-fetcher offset=0 read (cross-fetcher
      // invariant: non-destructive, so still sees the 9999 reply).
      { ok: true, result: sharedQueue },
    ]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('1234');
    await flushDetachedSideEffects(fetchSpy, 4);
    const getUpdatesUrls = getGetUpdatesCalls(fetchSpy).map(getCallUrl);
    const hasNegativeOffset = getUpdatesUrls.some((u: string): boolean => /offset=-\d+/.test(u));
    expect(hasNegativeOffset).toBe(false);
    const isAllOffsetZero = getUpdatesUrls.every((u: string): boolean => /offset=0(?!\d)/.test(u));
    expect(isAllOffsetZero).toBe(true);
    // Cross-fetcher invariant: a second offset=0 poll (concurrent fetcher
    // on a separate CI matrix runner) STILL sees the other-bank reply
    // since the first fetcher never advanced the cursor past it.
    const secondReadUrl =
      'https://api.telegram.org/botTEST_TOKEN/getUpdates?offset=0&limit=100&timeout=1';
    const fetchProbe = fetchSpy as unknown as (u: string) => Promise<Response>;
    const secondReadRaw = await fetchProbe(secondReadUrl);
    const secondReadBody = (await secondReadRaw.json()) as {
      readonly result: readonly {
        readonly message?: { readonly reply_to_message?: { readonly message_id: number } };
      }[];
    };
    const hasOtherBankReply = secondReadBody.result.some(
      (u): boolean => u.message?.reply_to_message?.message_id === 9999,
    );
    expect(hasOtherBankReply).toBe(true);
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

  it.each(skipReasonScenarios)(
    '$label — returns false synchronously, no network call',
    async sc => {
      installFetchWithDefaultPrompt([]);
      const args = makeArgs(sc.overrides);
      const result = await fetchOtpFromTelegram(args);
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('TF-6 wrong-chat — returns false; never picks the off-chat reply', async () => {
    installFetchWithDefaultPrompt([
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

  it('TF-7 prompt-failed — returns false when sendMessage fails (no poll calls)', async () => {
    // Telegram returns ok:false on sendMessage → fetcher cannot
    // proceed (no message_id to scope replies against), aborts
    // BEFORE the poll loop. With A.fix-2 there is no pre-prompt
    // probe either — sendMessage is the first network call.
    installFetch({
      sendMessage: [{ ok: false, description: 'bad token' }],
      getUpdates: [],
    });
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    const sendCalls = getSendMessageCalls(fetchSpy);
    const updateCalls = getGetUpdatesCalls(fetchSpy);
    expect(sendCalls).toHaveLength(1);
    // Zero poll cycles — sendMessage failed before the poll loop
    // entered AND there is no longer a pre-prompt probe.
    expect(updateCalls).toHaveLength(0);
  });

  it('TF-8 sendMessage runs BEFORE first poll — no pre-prompt probe', async () => {
    // A.fix-2 replaced the old order (probe → sendMessage → poll)
    // with (sendMessage → poll) because the probe used
    // `offset=-1` which Telegram interprets as "forget all
    // previous updates" — purging concurrent parallel fetchers'
    // pending replies. Per-prompt isolation comes from the
    // `reply_to_message.message_id` filter (TF-4d) — the floor
    // probe served no additional safety once that filter exists.
    installFetchWithDefaultPrompt([{ ok: true, result: [makeReplyUpdate(1001, '424242')] }]);
    const args = makeArgs();
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe('424242');
    const calls = readFetchCalls(fetchSpy);
    const firstUrl = getCallUrl(calls[0]);
    const secondUrl = getCallUrl(calls[1]);
    expect(firstUrl).toContain('/sendMessage');
    expect(secondUrl).toContain('/getUpdates');
    expect(secondUrl).toContain('offset=0');
  });

  it('TF-9 ack on match — sends a confirmation reply scoped to the prompt', async () => {
    // UX: after a successful match the bot acknowledges receipt
    // so the user knows their reply was consumed and the scrape
    // is proceeding. Best-effort — failures must not affect the
    // OTP flow (covered by TF-9b). Detached post-match per
    // `fetchOtpFromTelegram`'s `detachSideEffect` wiring so the
    // OTP digits return to the pipeline before this HTTP call
    // resolves; flush microtasks before asserting on it.
    installFetchWithDefaultPrompt([{ ok: true, result: [makeReplyUpdate(2, '424242')] }]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    // prompt + poll + ack + GC inspect = 4
    await flushDetachedSideEffects(fetchSpy, 4);
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
    installFetchWithDefaultPrompt([]);
    const args = makeArgs({ timeoutMs: 500 });
    const result = await fetchOtpFromTelegram(args);
    expect(result).toBe(false);
    // prompt + ≥1 poll + timeout-ack + GC inspect = ≥4
    await flushDetachedSideEffects(fetchSpy, 4);
    const sendMessageCalls = getSendMessageCalls(fetchSpy);
    // 1 prompt + 1 timeout-ack.
    expect(sendMessageCalls.length).toBe(2);
    const ackCall = sendMessageCalls[1];
    const ackBody = parseFetchBody(ackCall);
    expect(ackBody.reply_to_message_id).toBe(DEFAULT_PROMPT_ID);
    const ackText = typeof ackBody.text === 'string' ? ackBody.text : '';
    expect(ackText).toMatch(/no reply/);
  });

  it('TF-11 prune-old-updates — confirms updates older than the 10-min window', async () => {
    // CodeRabbit PR #226 #7 + user direction 2026-05-12. After
    // fetchOtpFromTelegram resolves (match OR timeout), it confirms
    // every queued update whose `message.date` is older than
    // `now - 600s`. Concurrent fetchers' RECENT replies (date >= now
    // - 600) survive because their prompts are also <10 min old.
    // This bounds the queue size so the offset=0&limit=100 read
    // window never starves an in-flight reply.
    const nowSec = Math.floor(Date.now() / 1000);
    const ancientDate = nowSec - 1200; // 20 min old → stale, prune
    const recentDate = nowSec - 100; // <2 min old → keep
    installFetchWithDefaultPrompt([
      { ok: true, result: [makeReplyUpdate(50, '111111')] },
      // After match: GC inspect call returns mixed queue.
      {
        ok: true,
        result: [
          { update_id: 10, message: { chat: { id: -100456789 }, text: 'old', date: ancientDate } },
          { update_id: 11, message: { chat: { id: -100456789 }, text: 'old2', date: ancientDate } },
          {
            update_id: 12,
            message: { chat: { id: -100456789 }, text: 'recent', date: recentDate },
          },
        ],
      },
    ]);
    const args = makeArgs();
    await fetchOtpFromTelegram(args);
    // prompt + poll + ack + GC inspect + GC confirm = 5
    await flushDetachedSideEffects(fetchSpy, 5);
    const getUpdatesCalls = getGetUpdatesCalls(fetchSpy);
    const urls = getUpdatesCalls.map(getCallUrl);
    // Boundary-aware regex per CodeRabbit PR #226 review on TF-11.
    // The previous substring `u.includes('offset=12')` would also
    // match `offset=120 / 121 / 125 …`, so an off-by-one regression
    // in `computePruneOffset` (e.g. all-stale branch returning
    // `update_id` instead of `update_id + 1`) could silently pass.
    // `/offset=12(?!\d)/` pins the value to exactly 12, and the
    // companion `offset=0` pin verifies that GC inspect precedes
    // confirm and uses the non-destructive read.
    const hasConfirmCall = urls.some((u: string): boolean => /offset=12(?!\d)/.test(u));
    expect(hasConfirmCall).toBe(true);
    const hasInspectCall = urls.some((u: string): boolean => /offset=0(?!\d)/.test(u));
    expect(hasInspectCall).toBe(true);
  });
});

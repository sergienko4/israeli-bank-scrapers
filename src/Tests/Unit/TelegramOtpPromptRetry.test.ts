/**
 * Unit tests for the bounded prompt-send retry inside
 * {@link fetchOtpFromTelegram}.
 *
 * <p>CI run 30850794919 lost a real Beinleumi OTP because a single
 * `sendMessage` rejection aborted the fetcher outright while the
 * user already held the code. These tests pin the retry budget, the
 * retryable/non-retryable split and the `retry_after` cap.
 *
 * <p>Lives beside `TelegramOtpFetcher.test.ts` rather than inside it
 * because `humanDelay` is mocked here, so the retry ladder runs
 * instantly. TF-13 in the sibling file asserts real wall-clock poll
 * spacing and must keep the genuine implementation — Jest's module
 * registry is per-file, so both hold at once.
 */

import { jest } from '@jest/globals';

import {
  type IHttpFailure,
  type ITestLogger,
  makeFailedResponse,
  makeStubLogger,
} from '../Helpers/TelegramOtpFixtures.js';

const MOCK_HUMAN_DELAY = jest.fn();

jest.unstable_mockModule('../../Scrapers/Pipeline/Mediator/Timing/Waiting.js', () => ({
  /**
   * Instant stand-in for the real delay — records the requested
   * window so tests assert the schedule without sleeping for it.
   * @returns Immediately-resolved promise.
   */
  humanDelay: MOCK_HUMAN_DELAY,
}));

const FETCHER_MODULE = await import('../E2eReal/TelegramOtpFetcher.js');
const FETCH_OTP_FROM_TELEGRAM = FETCHER_MODULE.fetchOtpFromTelegram;

type ITelegramFetchArgs = Parameters<typeof FETCH_OTP_FROM_TELEGRAM>[0];

/**
 * Build fetcher args pointed at the stub logger.
 *
 * <p>`timeoutMs` is the smallest value the fetcher's own arg guard
 * accepts, so a prompt that DOES land falls straight back out of the
 * poll loop — these tests pin the send ladder, not the polling.
 *
 * @param log - Logger to observe.
 * @returns Fetcher args.
 */
function makeArgs(log: ITestLogger): ITelegramFetchArgs {
  return {
    botToken: 'TEST_TOKEN',
    chatId: '-100456789',
    bankName: 'Beinleumi',
    bankRegex: /(\d{4,8})/,
    timeoutMs: 1,
    log,
  } as unknown as ITelegramFetchArgs;
}

/** Telegram flood-control rejection advertising a 1 s cooldown. */
const FLOOD_CONTROL: IHttpFailure = {
  status: 429,
  statusText: 'Too Many Requests',
  body: {
    ok: false,
    error_code: 429,
    description: 'Too Many Requests: retry after 1',
    parameters: { retry_after: 1 },
  },
};

/** Revoked/!invalid token — a caller defect, never worth retrying. */
const UNAUTHORIZED: IHttpFailure = {
  status: 401,
  statusText: 'Unauthorized',
  body: { ok: false, error_code: 401, description: 'Unauthorized' },
};

/** Flood control advertising a cooldown far past the local cap. */
const LONG_COOLDOWN: IHttpFailure = {
  status: 429,
  statusText: 'Too Many Requests',
  body: {
    ok: false,
    error_code: 429,
    description: 'Too Many Requests: retry after 600',
    parameters: { retry_after: 600 },
  },
};

/** message_id the successful prompt fixture assigns. */
const PROMPT_ID = 5000;

/**
 * Telegram gateway fault. Ambiguous about delivery, so the fetcher
 * must fail loudly instead of risking a duplicate prompt.
 */
const GATEWAY_FAULT: IHttpFailure = {
  status: 502,
  statusText: 'Bad Gateway',
  body: { ok: false, error_code: 502, description: 'Bad Gateway' },
};

/**
 * Flood control that omits `parameters.retry_after`. Telegram does
 * not always advertise a cooldown, which is what keeps the
 * exponential fallback in `computePromptRetryMs` reachable.
 */
const UNADVERTISED_COOLDOWN: IHttpFailure = {
  status: 429,
  statusText: 'Too Many Requests',
  body: { ok: false, error_code: 429, description: 'Too Many Requests' },
};

/** Captures `fetch` calls per test. */
let fetchSpy: jest.Mock;
let originalFetch: typeof fetch | undefined;

/**
 * Build a successful Response stub.
 * @param body - Body to expose via `json()`.
 * @returns Response stub.
 */
function makeOkResponse(body: Record<string, unknown>): Response {
  /**
   * Body accessor for the stub.
   * @returns The queued body.
   */
  const json = (): Promise<unknown> => Promise.resolve(body);
  return { ok: true, status: 200, statusText: 'OK', json } as unknown as Response;
}

/** Successful `sendMessage` envelope. */
const PROMPT_OK = { ok: true, result: { message_id: PROMPT_ID } };

/**
 * HTTP 200 carrying a Telegram-level rejection. Not a transport
 * fault and not flood control — retrying answers identically.
 */
const ENVELOPE_REJECT = { ok: false, description: 'bad token' };

/** Empty `getUpdates` envelope — keeps the poll loop starved. */
const UPDATES_EMPTY = { ok: true, result: [] };

/** Non-failure steps a prompt script can queue. */
type PromptStep = IHttpFailure | 'ok' | 'envelope-reject' | 'throw';

/**
 * Resolve what a single scripted step should answer with.
 *
 * <p>`throw` models a transport fault: `fetch` itself rejects, so no
 * response is ever observed.
 *
 * @param step - Scripted outcome for this call.
 * @returns Resolved Response stub, or a rejection for `throw`.
 */
function buildStepResponse(step: PromptStep): Promise<Response> {
  if (step === 'throw') {
    const fault = new TypeError('fetch failed');
    return Promise.reject(fault);
  }
  if (step === 'ok') {
    const success = makeOkResponse(PROMPT_OK);
    return Promise.resolve(success);
  }
  if (step === 'envelope-reject') {
    const refusal = makeOkResponse(ENVELOPE_REJECT);
    return Promise.resolve(refusal);
  }
  const rejected = makeFailedResponse(step);
  return Promise.resolve(rejected);
}

/**
 * Install a fetch that replays a queued `sendMessage` script.
 *
 * <p>Entries are consumed in order; once the script is exhausted the
 * last entry repeats, so a 1-entry script models "always fails".
 * Every non-`sendMessage` URL answers with an empty update list.
 *
 * @param script - Ordered `sendMessage` outcomes.
 * @returns The installed spy.
 */
function installPromptScript(script: readonly PromptStep[]): jest.Mock {
  let call = -1;
  /**
   * Scripted implementation.
   * @param url - Requested Telegram endpoint.
   * @returns Response stub for this call.
   */
  const impl = (url: unknown): Promise<Response> => {
    const target = String(url);
    const isSend = target.includes('/sendMessage');
    if (!isSend) {
      const updates = makeOkResponse(UPDATES_EMPTY);
      return Promise.resolve(updates);
    }
    call += 1;
    const index = Math.min(call, script.length - 1);
    const step = script[index];
    return buildStepResponse(step);
  };
  fetchSpy = jest.fn(impl);
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy;
  return fetchSpy;
}

/**
 * Count the prompt attempts the fetcher issued.
 *
 * <p>Matches on `force_reply`, which only the prompt payload
 * carries. The detached timeout/match acknowledgements post to the
 * same `sendMessage` endpoint, so a URL-only filter would count
 * them and make the assertion racy.
 *
 * @returns Number of prompt attempts.
 */
function countPromptSends(): number {
  const calls = fetchSpy.mock.calls as readonly (readonly unknown[])[];
  const sends = calls.filter((call): boolean => {
    const init = call[1] as { body?: string } | undefined;
    const body = init?.body ?? '';
    return body.includes('force_reply');
  });
  return sends.length;
}

/**
 * Collect every warn payload carrying the given event name.
 * @param log - Stub logger handed to the fetcher.
 * @param event - Structured event name to match.
 * @returns Matching payloads in emission order.
 */
function readWarnEvents(log: ITestLogger, event: string): Record<string, unknown>[] {
  const calls = log.warn.mock.calls as readonly (readonly unknown[])[];
  const hits = calls.filter((call): boolean => {
    const payload = call[0] as { event?: string };
    return payload.event === event;
  });
  return hits.map((call): Record<string, unknown> => call[0] as Record<string, unknown>);
}

/** Structured event emitted once per retried attempt. */
const RETRY_EVENT = 'telegram.otp.fetch.prompt-retry';

/** Structured event emitted once the send budget is spent. */
const FAILED_EVENT = 'telegram.otp.fetch.prompt-failed';

/**
 * Failure taxonomy for the retryable statuses — one parameterized
 * case per distinguishable reason Telegram refuses a prompt.
 *
 * <p>These arms live here, not in `TelegramOtpFetcher.test.ts`,
 * because both statuses now drive the retry ladder: with the real
 * `humanDelay` each case would sleep for seconds of genuine wall
 * clock and edge Jest's default timeout. `humanDelay` is mocked in
 * this file, so the assertions cost nothing AND additionally prove
 * the taxonomy survives the ladder rather than only the first send.
 */
const RETRYABLE_TAXONOMY_CASES = [
  {
    label: 'TR-10 flood control — 429 surfaces error_code and retry_after',
    failure: FLOOD_CONTROL,
    expected: {
      status: 429,
      errorCode: 429,
      description: 'Too Many Requests: retry after 1',
      retryAfterSeconds: 1,
    },
  },
  {
    label: 'TR-11 gateway error — description-less body falls back to status text',
    failure: { status: 502, statusText: 'Bad Gateway', body: {} },
    expected: { status: 502, errorCode: 0, description: 'Bad Gateway', retryAfterSeconds: 0 },
  },
] as const;

const ORIGINAL_ENV = process.env;

beforeEach((): void => {
  process.env = { ...ORIGINAL_ENV };
  // The fetcher's own guard skips outside CI; opt in so the send
  // ladder is exercised rather than short-circuited.
  process.env.CI = 'true';
  MOCK_HUMAN_DELAY.mockReset();
  MOCK_HUMAN_DELAY.mockResolvedValue(undefined);
});

/**
 * Yield microtask ticks so the fetcher's detached ack / GC chains
 * settle against the mock rather than against the restored
 * `globalThis.fetch` (which would be a real Telegram call in a
 * jest worker). Recursive `Promise.resolve().then` yields one tick
 * per level without tripping `no-await-in-loop`.
 *
 * @param ticks - Remaining ticks to yield.
 * @returns True once the budget is exhausted.
 */
function drainDetachedEffects(ticks = 20): Promise<boolean> {
  if (ticks <= 0) return Promise.resolve(true);
  return Promise.resolve().then((): Promise<boolean> => drainDetachedEffects(ticks - 1));
}

afterEach(async (): Promise<void> => {
  await drainDetachedEffects();
  if (originalFetch !== undefined) {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    originalFetch = undefined;
  }
  process.env = ORIGINAL_ENV;
  jest.clearAllMocks();
});

describe('fetchOtpFromTelegram prompt retry', (): void => {
  it('TR-1: retries flood control and proceeds once the send lands', async (): Promise<void> => {
    // The exact CI shape: the first prompt is rejected by per-chat
    // flood control while the bank has already texted the user. The
    // fetcher must recover instead of discarding a live OTP window.
    installPromptScript([FLOOD_CONTROL, 'ok']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    await FETCH_OTP_FROM_TELEGRAM(args);
    const sends = countPromptSends();
    expect(sends).toBe(2);
    const failures = readWarnEvents(log, FAILED_EVENT);
    expect(failures).toHaveLength(0);
  });

  it('TR-2: never retries a non-retryable rejection', async (): Promise<void> => {
    // 401 is a caller defect — a revoked token answers identically
    // forever. Retrying only burns the bank's OTP window.
    installPromptScript([UNAUTHORIZED]);
    const log = makeStubLogger();
    const args = makeArgs(log);
    await FETCH_OTP_FROM_TELEGRAM(args);
    const sends = countPromptSends();
    expect(sends).toBe(1);
    const retries = readWarnEvents(log, RETRY_EVENT);
    expect(retries).toHaveLength(0);
  });

  it('TR-3: stops after the attempt budget and reports failure', async (): Promise<void> => {
    // Bounded, not infinite: a sustained Telegram outage must fail
    // the run promptly rather than stall it past the OTP window.
    installPromptScript([FLOOD_CONTROL]);
    const log = makeStubLogger();
    const args = makeArgs(log);
    const result = await FETCH_OTP_FROM_TELEGRAM(args);
    expect(result).toBe(false);
    const sends = countPromptSends();
    expect(sends).toBe(3);
    const failures = readWarnEvents(log, FAILED_EVENT);
    expect(failures).toHaveLength(1);
  });

  it('TR-4: honours the advertised retry_after between attempts', async (): Promise<void> => {
    // Ignoring `retry_after` guarantees the next attempt is rejected
    // on the same grounds, so the budget would be spent for nothing.
    installPromptScript([FLOOD_CONTROL, 'ok']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    await FETCH_OTP_FROM_TELEGRAM(args);
    const retries = readWarnEvents(log, RETRY_EVENT);
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ attempt: 1, retryAfterSeconds: 1, waitMs: 1_000 });
  });

  it('TR-5: caps a retry_after longer than the OTP window', async (): Promise<void> => {
    // Telegram answers flood control with cooldowns of 30-600 s. The
    // code the user already holds expires long before that, so the
    // wait is capped at 5 s and the attempt is spent early.
    installPromptScript([LONG_COOLDOWN, 'ok']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    await FETCH_OTP_FROM_TELEGRAM(args);
    const retries = readWarnEvents(log, RETRY_EVENT);
    expect(retries[0]).toMatchObject({ retryAfterSeconds: 600, waitMs: 5_000 });
    // The cap must be applied, not merely reported.
    expect(MOCK_HUMAN_DELAY).toHaveBeenCalledWith(5_000, 6_000);
  });

  it('TR-6: waits for the schedule it logged', async (): Promise<void> => {
    // Guards against the wait being logged but never applied — a
    // retry that fires instantly would re-trip the same flood limit.
    // The upper bound is the jitter spread: every rate-limited job
    // gets the same whole-second `retry_after`, so waking exactly on
    // it would rebuild the burst that caused the rejection.
    installPromptScript([FLOOD_CONTROL, 'ok']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    await FETCH_OTP_FROM_TELEGRAM(args);
    expect(MOCK_HUMAN_DELAY).toHaveBeenCalledWith(1_000, 2_000);
  });

  it('TR-7: never retries a 200 carrying a Telegram rejection', async (): Promise<void> => {
    // A 200 whose envelope says `ok:false` is a Telegram-level
    // refusal, not a transport fault. It must not be mistaken for
    // one: reading the failure detail off an incomplete Response
    // once threw inside the send, and the catch relabelled it
    // `status: 0` — the sentinel reserved for "no response at all"
    // — which would make this endlessly retryable.
    installPromptScript(['envelope-reject']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    const result = await FETCH_OTP_FROM_TELEGRAM(args);
    expect(result).toBe(false);
    const sends = countPromptSends();
    expect(sends).toBe(1);
    const failures = readWarnEvents(log, FAILED_EVENT);
    expect(failures[0]).toMatchObject({ status: 200, description: 'bad token' });
  });

  it('TR-8: never re-sends after a gateway fault', async (): Promise<void> => {
    // A 5xx does NOT prove Telegram dropped the message — a gateway
    // can fault on the response path, after the prompt was already
    // accepted. Re-sending would then add a second prompt, and the
    // id of the first is unknowable because Telegram only returns a
    // message_id on success. Same silent-OTP-loss risk as TR-9.
    installPromptScript([GATEWAY_FAULT]);
    const log = makeStubLogger();
    const args = makeArgs(log);
    const result = await FETCH_OTP_FROM_TELEGRAM(args);
    expect(result).toBe(false);
    const sends = countPromptSends();
    expect(sends).toBe(1);
    const retries = readWarnEvents(log, RETRY_EVENT);
    expect(retries).toHaveLength(0);
  });

  it('TR-12: falls back to the schedule when no cooldown is advertised', async (): Promise<void> => {
    // Flood control proves non-delivery, so it is retried even when
    // Telegram omits `parameters.retry_after`. Without an advertised
    // cooldown the wait comes from the exponential schedule: 500 ms
    // for the first failure.
    installPromptScript([UNADVERTISED_COOLDOWN, 'ok']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    await FETCH_OTP_FROM_TELEGRAM(args);
    const sends = countPromptSends();
    expect(sends).toBe(2);
    const retries = readWarnEvents(log, RETRY_EVENT);
    expect(retries[0]).toMatchObject({ status: 429, retryAfterSeconds: 0, waitMs: 500 });
  });

  it('TR-9: never re-sends after a transport fault', async (): Promise<void> => {
    // A rejected `fetch` proves only that WE saw no response — the
    // POST may have reached Telegram and put a prompt in the chat.
    // Re-sending would add a second prompt with a different
    // message_id, and the fetcher matches replies against the id it
    // last received, so a user replying to the prompt they saw first
    // would be ignored. That is the silent OTP loss this retry
    // exists to prevent, so ambiguity must fail loudly instead.
    installPromptScript(['throw']);
    const log = makeStubLogger();
    const args = makeArgs(log);
    const result = await FETCH_OTP_FROM_TELEGRAM(args);
    expect(result).toBe(false);
    const sends = countPromptSends();
    expect(sends).toBe(1);
    const retries = readWarnEvents(log, RETRY_EVENT);
    expect(retries).toHaveLength(0);
  });

  it.each(RETRYABLE_TAXONOMY_CASES)('$label', async ({ failure, expected }): Promise<void> => {
    installPromptScript([failure]);
    const log = makeStubLogger();
    const args = makeArgs(log);
    const result = await FETCH_OTP_FROM_TELEGRAM(args);
    expect(result).toBe(false);
    const failures = readWarnEvents(log, FAILED_EVENT);
    expect(failures[0]).toMatchObject(expected);
  });
});

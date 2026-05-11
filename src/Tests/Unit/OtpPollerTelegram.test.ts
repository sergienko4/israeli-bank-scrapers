/**
 * Unit tests for the Telegram tier integration in
 * {@link createOtpPoller}. Verifies the 4-tier ladder ordering:
 *   1. env var
 *   2. Telegram (NEW — opt-in via bankRegex + env vars)
 *   3. poll file
 *   4. readline (TTY) — not exercised here (non-TTY in jest)
 *
 * The Telegram fetcher is mocked via `jest.unstable_mockModule` so
 * no Telegram API call escapes the test runtime.
 */

import { jest } from '@jest/globals';

import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';

const MOCK_TELEGRAM = jest.fn();

jest.unstable_mockModule('../E2eReal/TelegramOtpFetcher.js', () => ({
  /**
   * Mock fetcher returning the value queued by the test.
   * @returns Whatever the mock has been configured to return.
   */
  fetchOtpFromTelegram: MOCK_TELEGRAM,
  default: MOCK_TELEGRAM,
}));

const POLLER_MODULE = await import('../E2eReal/OtpPoller.js');
const CREATE_OTP_POLLER = POLLER_MODULE.createOtpPoller;
const DEFAULT_POLL_TIMEOUT_MS = POLLER_MODULE.DEFAULT_POLL_TIMEOUT_MS;

/**
 * Build a fresh stub logger that satisfies the full
 * {@link ScraperLogger} structural contract via cast.
 * @returns Logger usable in `createOtpPoller` args.
 */
function makeLogger(): ScraperLogger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as ScraperLogger;
}

const ORIGINAL_ENV = process.env;

beforeEach((): void => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BEINLEUMI_OTP;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  // Telegram tier is CI-only (skips silently otherwise). The unit
  // tests below assert the tier's behaviour, so we opt in
  // explicitly to bypass the dev-machine guard.
  process.env.CI = 'true';
  MOCK_TELEGRAM.mockReset();
});

afterAll((): void => {
  process.env = ORIGINAL_ENV;
});

/** Concrete poller-args type alias — exact shape the factory builds. */
type IPollerArgs = Parameters<typeof CREATE_OTP_POLLER>[0];

const ENV_VAR_DEFAULT = 'BEINLEUMI_OTP';
const FILE_NAME_DEFAULT = 'beinleumi-otp.txt';
const BANK_NAME_DEFAULT = 'Beinleumi';
const BANK_REGEX_DEFAULT = /(\d{4,8})/;

/**
 * Build a fully-populated poller args bundle (used by TP-1, TP-2,
 * TP-4, TP-6 — the cases that don't omit any field).
 * @returns Complete args.
 */
function buildFullArgs(): IPollerArgs {
  return {
    envVar: ENV_VAR_DEFAULT,
    fileName: FILE_NAME_DEFAULT,
    log: makeLogger(),
    bankName: BANK_NAME_DEFAULT,
    bankRegex: BANK_REGEX_DEFAULT,
  };
}

/**
 * Variant: full args minus `bankRegex`. Used by TP-3.
 * Constructed as a complete object literal — no destructuring so
 * the field is absent at runtime (not just `undefined`-valued).
 * @returns Args without bankRegex.
 */
function buildArgsWithoutBankRegex(): IPollerArgs {
  return {
    envVar: ENV_VAR_DEFAULT,
    fileName: FILE_NAME_DEFAULT,
    log: makeLogger(),
    bankName: BANK_NAME_DEFAULT,
  };
}

/**
 * Variant: full args minus `bankName`. Used by TP-5.
 * @returns Args without bankName.
 */
function buildArgsWithoutBankName(): IPollerArgs {
  return {
    envVar: ENV_VAR_DEFAULT,
    fileName: FILE_NAME_DEFAULT,
    log: makeLogger(),
    bankRegex: BANK_REGEX_DEFAULT,
  };
}

/**
 * Set the env vars that would normally be present in CI.
 * @returns True once the env is staged.
 */
function stageCiEnv(): true {
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_CHAT_ID = '-100';
  return true;
}

/**
 * Fire the retriever, swallow any rejection (e.g. 180s file-poll
 * timeout), and yield once so the Telegram-tier microtask had a
 * chance to run.
 * @param retrieve - Result of `CREATE_OTP_POLLER(...)`.
 * @returns Resolves once the microtask flushed.
 */
async function fireAndYield(retrieve: () => Promise<string>): Promise<true> {
  const pending = retrieve();
  pending.catch((): true => true);
  await Promise.resolve();
  return true;
}

/**
 * Skip-tier scenarios — every case asserts MOCK_TELEGRAM is
 * never called. The shared assertion is in `runSkipScenario`.
 *
 * @param args - Args bundle for this scenario.
 * @returns True once the scenario completed.
 */
async function runSkipScenario(args: IPollerArgs): Promise<true> {
  MOCK_TELEGRAM.mockResolvedValue('NEVER_RETURNED');
  const retrieve = CREATE_OTP_POLLER(args);
  await fireAndYield(retrieve);
  expect(MOCK_TELEGRAM).not.toHaveBeenCalled();
  return true;
}

/**
 * No-op env stage — used by TP-4 where the absence of Telegram
 * env vars is itself the precondition. `beforeEach` already
 * deletes both vars; this affirms the contract without doing
 * additional setup.
 * @returns Always true.
 */
function noEnvSetup(): true {
  return true;
}

/**
 * Env stage that mirrors TP-6 — Telegram secrets present, but
 * the CI flag is unset to simulate a developer workstation.
 * @returns True once the env is staged.
 */
function ciFlagUnsetEnvSetup(): true {
  delete process.env.CI;
  stageCiEnv();
  return true;
}

/**
 * Skip-scenario row — TP-3 .. TP-6 share the same assertion
 * (MOCK_TELEGRAM never called); only the per-case env setup and
 * args bundle differ. Adding a new skip reason means one row in
 * `SKIP_SCENARIOS`, not a new test block.
 */
interface ISkipScenario {
  readonly label: string;
  readonly envSetup: () => true;
  readonly argsBuilder: () => IPollerArgs;
}

const SKIP_SCENARIOS: readonly ISkipScenario[] = [
  {
    label: 'TP-3 skipped without bankRegex',
    envSetup: stageCiEnv,
    argsBuilder: buildArgsWithoutBankRegex,
  },
  {
    label: 'TP-4 skipped without env vars (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)',
    envSetup: noEnvSetup,
    argsBuilder: buildFullArgs,
  },
  {
    label: 'TP-5 skipped without bankName',
    envSetup: stageCiEnv,
    argsBuilder: buildArgsWithoutBankName,
  },
  {
    label: 'TP-6 skipped when CI env unset — local-dev guard',
    envSetup: ciFlagUnsetEnvSetup,
    argsBuilder: buildFullArgs,
  },
];

describe('createOtpPoller — Telegram tier', () => {
  it('TP-1 env var wins — Telegram is not consulted', async () => {
    process.env.BEINLEUMI_OTP = 'FROM_ENV';
    stageCiEnv();
    MOCK_TELEGRAM.mockResolvedValue('FROM_TELEGRAM');
    const args = buildFullArgs();
    const retrieve = CREATE_OTP_POLLER(args);
    const code = await retrieve();
    expect(code).toBe('FROM_ENV');
    expect(MOCK_TELEGRAM).not.toHaveBeenCalled();
  });

  it('TP-2 Telegram wins — when env unset and Telegram returns code', async () => {
    stageCiEnv();
    MOCK_TELEGRAM.mockResolvedValue('FROM_TELEGRAM');
    const args = buildFullArgs();
    const retrieve = CREATE_OTP_POLLER(args);
    const code = await retrieve();
    expect(code).toBe('FROM_TELEGRAM');
    expect(MOCK_TELEGRAM).toHaveBeenCalledTimes(1);
  });

  for (const sc of SKIP_SCENARIOS) {
    it(sc.label, async () => {
      sc.envSetup();
      const args = sc.argsBuilder();
      await runSkipScenario(args);
    });
  }

  it('TP-7 forwards full pipeline OTP watchdog as timeoutMs (≥ 180s)', async () => {
    // Regression for PR #215 CI run 25569338073 (OneZero/Beinleumi
    // failures): a 30 s Telegram budget is shorter than realistic
    // human latency (read SMS, switch app, type reply) — the fetcher
    // gave up before the user replied, then the file-poll fallback
    // never sees Telegram replies. The test poller MUST hand the
    // Telegram tier the same budget the pipeline OTP watchdog gives
    // the retriever as a whole (180 s in OtpFillPhaseActions). Any
    // smaller budget causes a guaranteed CI miss.
    stageCiEnv();
    MOCK_TELEGRAM.mockResolvedValue('FROM_TELEGRAM');
    const args = buildFullArgs();
    const retrieve = CREATE_OTP_POLLER(args);
    await retrieve();
    expect(MOCK_TELEGRAM).toHaveBeenCalledTimes(1);
    const calls = MOCK_TELEGRAM.mock.calls as readonly (readonly [{ timeoutMs: number }])[];
    const firstCall = calls[0];
    const passedArgs = firstCall[0];
    expect(passedArgs.timeoutMs).toBe(DEFAULT_POLL_TIMEOUT_MS);
  });

  it('TP-8 engaged + empty → throws; never falls through to file/readline', async () => {
    // Regression: with the old fall-through-on-empty design, an
    // empty Telegram result triggered a 180 s file-poll on a file
    // no human in CI is going to write to. Total budget grew to
    // 360 s and the pipeline OTP watchdog (180 s) raced the
    // retriever, surfacing as `OTP poll timeout after 180000ms`
    // even though Telegram had already exhausted its window. The
    // race-free design throws as soon as the Telegram tier
    // returns empty when it was the configured channel — file
    // and readline tiers stay reachable only when Telegram is
    // opted out (CI guard / missing secrets / missing args).
    stageCiEnv();
    MOCK_TELEGRAM.mockResolvedValue(false);
    const args = buildFullArgs();
    const retrieve = CREATE_OTP_POLLER(args);
    const pending = retrieve();
    await expect(pending).rejects.toThrow(/Telegram OTP tier exhausted/);
    expect(MOCK_TELEGRAM).toHaveBeenCalledTimes(1);
  });
});

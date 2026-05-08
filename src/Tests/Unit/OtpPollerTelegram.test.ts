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
  MOCK_TELEGRAM.mockReset();
});

afterAll((): void => {
  process.env = ORIGINAL_ENV;
});

describe('createOtpPoller — Telegram tier', () => {
  it('TP-1 env var wins — Telegram is not consulted', async () => {
    process.env.BEINLEUMI_OTP = 'FROM_ENV';
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    process.env.TELEGRAM_CHAT_ID = '-100';
    MOCK_TELEGRAM.mockResolvedValue('FROM_TELEGRAM');
    const retrieve = CREATE_OTP_POLLER({
      envVar: 'BEINLEUMI_OTP',
      fileName: 'beinleumi-otp.txt',
      log: makeLogger(),
      bankRegex: /Beinleumi\D*(\d{4,8})/,
    });
    const code = await retrieve();
    expect(code).toBe('FROM_ENV');
    expect(MOCK_TELEGRAM).not.toHaveBeenCalled();
  });

  it('TP-2 Telegram wins — when env unset and Telegram returns code', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    process.env.TELEGRAM_CHAT_ID = '-100';
    MOCK_TELEGRAM.mockResolvedValue('FROM_TELEGRAM');
    const retrieve = CREATE_OTP_POLLER({
      envVar: 'BEINLEUMI_OTP',
      fileName: 'beinleumi-otp.txt',
      log: makeLogger(),
      bankRegex: /Beinleumi\D*(\d{4,8})/,
    });
    const code = await retrieve();
    expect(code).toBe('FROM_TELEGRAM');
    expect(MOCK_TELEGRAM).toHaveBeenCalledTimes(1);
  });

  it('TP-3 Telegram skipped without bankRegex — no fetcher call', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    process.env.TELEGRAM_CHAT_ID = '-100';
    MOCK_TELEGRAM.mockResolvedValue('FROM_TELEGRAM');
    // bankRegex omitted → Telegram tier MUST be skipped.
    const retrieve = CREATE_OTP_POLLER({
      envVar: 'BEINLEUMI_OTP',
      fileName: 'beinleumi-otp.txt',
      log: makeLogger(),
    });
    // No env, no Telegram, non-TTY → falls through to poll-file
    // which times out fast in this test (we don't await it).
    // Verify only that Telegram wasn't called.
    // Fire-and-forget; we assert the call sequence after a microtask
    // flush. The retrieve() promise is allowed to settle on its own.
    const pending3 = retrieve();
    pending3.catch((): null => null);
    await Promise.resolve();
    expect(MOCK_TELEGRAM).not.toHaveBeenCalled();
  });

  it('TP-4 Telegram skipped without env vars — no fetcher call', async () => {
    // bankRegex set BUT envs missing → Telegram tier MUST short-circuit.
    MOCK_TELEGRAM.mockResolvedValue('NEVER_RETURNED');
    const retrieve = CREATE_OTP_POLLER({
      envVar: 'BEINLEUMI_OTP',
      fileName: 'beinleumi-otp.txt',
      log: makeLogger(),
      bankRegex: /Beinleumi\D*(\d{4,8})/,
    });
    const pending4 = retrieve();
    pending4.catch((): null => null);
    await Promise.resolve();
    expect(MOCK_TELEGRAM).not.toHaveBeenCalled();
  });
});

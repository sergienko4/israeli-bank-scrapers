/**
 * OtpPoller — shared OTP retrieval helper for real-E2E tests that
 * need to prompt the user for an SMS code while jest runs in a
 * non-TTY background process. Resolves codes from (in order):
 *   1. the ENV_VAR when set (CI preset)
 *   2. a poll file at `<os.tmpdir()>/<FILE_NAME>` (interactive)
 *   3. a readline prompt (local TTY fallback)
 *
 * Zero bank knowledge — bank-specific tests pass ENV_VAR + FILE_NAME.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';
import { fetchOtpFromTelegram } from './TelegramOtpFetcher.js';

const POLL_INTERVAL_MS = 1000;
/**
 * Default OTP poll timeout — aligned to the pipeline OTP watchdog
 * (`DEFAULT_OTP_TIMEOUT_MS = 180_000` in `OtpFillPhaseActions.ts`).
 * The test poller MUST NOT cut off before the pipeline does, otherwise
 * a code arriving in the [old_test_120s, pipeline_180s] window would
 * surface as `OTP poll timeout` even though the pipeline would still
 * have accepted it. The 2026-05-07 Beinleumi run reproduced exactly
 * this race; see `OtpPollerPipelineTimeoutAlignment.test.ts`.
 */
const DEFAULT_POLL_TIMEOUT_MS = 180_000;

/** Args bundle for createOtpPoller — respects the 3-param ceiling. */
interface ICreateOtpPollerArgs {
  /** Env var to read first (e.g. 'PEPPER_OTP'). */
  readonly envVar: string;
  /** Poll-file basename (joined with os.tmpdir()). */
  readonly fileName: string;
  /** Pino logger for wait/detect/error messages. */
  readonly log: ScraperLogger;
  /** Optional custom timeout (ms) — defaults to 120s. */
  readonly timeoutMs?: number;
  /**
   * Optional digits-extraction regex used against the user's reply
   * text in the Telegram tier. When set AND `TELEGRAM_BOT_TOKEN` +
   * `TELEGRAM_CHAT_ID` env vars are populated AND `bankName` is set,
   * the poller consults Telegram between the env-var tier and the
   * poll-file tier. MUST contain exactly one capture group that
   * matches the OTP digits — typically `/(\d{4,8})/` since the
   * fetcher relies on `reply_to_message_id` for attribution, not
   * regex content. When omitted (or env vars unset), the poller's
   * behaviour is byte-identical to the pre-extension env → file →
   * readline ladder.
   */
  readonly bankRegex?: RegExp;
  /**
   * Display name surfaced to the user when the bot sends the
   * proactive prompt ("🔔 [bankName] CI is waiting for OTP …").
   * Required when the Telegram tier engages — without it the tier
   * silently skips with reason `'missing-bank-name'`.
   */
  readonly bankName?: string;
}

// Telegram tier inherits the full poller budget (DEFAULT_POLL_TIMEOUT_MS
// = 180 s, aligned to OtpFillPhaseActions.DEFAULT_OTP_TIMEOUT_MS). The
// budget flows via the `timeoutMs` param of `tryTelegramTier`. There is
// NO separate Telegram fetch timeout: a smaller budget would silently
// drop OTPs that arrive late (SMS dispatch + forwarder hop + reply can
// easily exceed 30 s), and a fall-through to file-poll would burn
// another 180 s on a poll no human is going to satisfy in CI.

/**
 * Read the poll file if present and non-empty, else empty string.
 * @param filePath - absolute path to the poll file
 * @returns OTP string or '' when file missing/empty
 */
async function readPollFile(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim();
  } catch {
    return '';
  }
}

/** Bundled args for pollForCode — respects the 3-param ceiling. */
interface IPollForCodeArgs {
  readonly filePath: string;
  readonly log: ScraperLogger;
  readonly phoneHint: string;
  readonly timeoutMs: number;
}

/**
 * Swallow unlink failures (file race between readers).
 * @param filePath - path to remove.
 * @returns True once settled.
 */
async function swallowUnlink(filePath: string): Promise<true> {
  try {
    await fs.unlink(filePath);
  } catch {
    // already removed / race — ignore
  }
  return true;
}

/** Recursive poll state — deadline + args. */
interface IPollState {
  readonly args: IPollForCodeArgs;
  readonly deadline: number;
}

/**
 * Recursive poll — reads once, recurses after an interval when empty.
 * @param state - Deadline + poll args.
 * @returns OTP code or ''.
 */
function pollUntil(state: IPollState): Promise<string> {
  return readPollFile(state.args.filePath).then((code): Promise<string> | string => {
    if (code.length > 0) return code;
    if (Date.now() >= state.deadline) return '';
    return setTimeoutPromise(POLL_INTERVAL_MS).then((): Promise<string> => pollUntil(state));
  });
}

/**
 * Poll the file until it contains a non-empty value.
 * @param args - Poll args bundle.
 * @returns OTP code string (throws on timeout)
 */
async function pollForCode(args: IPollForCodeArgs): Promise<string> {
  args.log.info(
    { phoneHint: args.phoneHint || 'unknown', file: args.filePath, timeoutMs: args.timeoutMs },
    `Waiting for OTP — write code to ${args.filePath}`,
  );
  const deadline = Date.now() + args.timeoutMs;
  const code = await pollUntil({ args, deadline });
  if (code.length === 0) {
    const waited = String(args.timeoutMs);
    throw new ScraperError(`OTP poll timeout after ${waited}ms`);
  }
  args.log.info({ codeLength: code.length }, 'OTP file detected — consuming');
  await swallowUnlink(args.filePath);
  return code;
}

/**
 * Prompt the user via a readline interface (interactive TTY only).
 * @param phoneHint - masked phone hint shown to the user
 * @returns OTP code string
 */
function promptViaReadline(phoneHint: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n[OTP] Enter the code sent to ${phoneHint || 'your phone'}: `, code => {
      rl.close();
      const trimmedCode = code.trim();
      resolve(trimmedCode);
    });
  });
}

/**
 * Are the caller-supplied args complete enough for the tier?
 * @param args - Poller args.
 * @returns True when bankRegex + bankName both present.
 */
function hasTelegramArgs(args: ICreateOtpPollerArgs): boolean {
  if (!args.bankRegex) return false;
  if ((args.bankName ?? '').length === 0) return false;
  return true;
}

/**
 * Is the runtime environment a CI runner? GitHub Actions / GitLab
 * CI / CircleCI / Travis all set `CI=true`. Never set on a
 * developer workstation unless explicitly opted-in via
 * `CI=true npm run test:e2e:real`.
 * @returns True when running on a CI runner.
 */
function isCiEnvironment(): boolean {
  const ciFlag = process.env.CI ?? '';
  return ciFlag === 'true' || ciFlag === '1';
}

/**
 * Are the Telegram secrets populated in the environment?
 * @returns True when both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
 *   are non-empty.
 */
function hasTelegramSecrets(): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  return botToken.length > 0 && chatId.length > 0;
}

/**
 * Pre-flight check for the Telegram tier. Returns `true` when the
 * tier MAY engage; returns `false` to short-circuit silently.
 * Extracted so {@link tryTelegramTier} stays inside the project's
 * cyclomatic-complexity budget (10).
 *
 * @param args - Poller args.
 * @returns True to proceed with the fetch.
 */
function shouldEngageTelegramTier(args: ICreateOtpPollerArgs): boolean {
  if (!hasTelegramArgs(args)) {
    args.log.debug(
      { event: 'telegram.otp.tier.skip', reason: 'missing-args', bankName: args.bankName },
      'Telegram OTP tier skipped — bankName missing from poller args',
    );
    return false;
  }
  if (!isCiEnvironment()) {
    args.log.debug(
      { event: 'telegram.otp.tier.skip', reason: 'not-ci', bankName: args.bankName },
      'Telegram OTP tier skipped — not running in CI',
    );
    return false;
  }
  if (!hasTelegramSecrets()) {
    args.log.debug(
      { event: 'telegram.otp.tier.skip', reason: 'missing-secrets', bankName: args.bankName },
      'Telegram OTP tier skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID empty',
    );
    return false;
  }
  return true;
}

/** Telegram-tier outcome — distinguishes "skipped" from "engaged but empty". */
interface ITelegramTierOutcome {
  /**
   * True when {@link shouldEngageTelegramTier} returned true AND
   * {@link fetchOtpFromTelegram} ran to completion (regardless of
   * whether it produced a code). The retriever uses this flag to
   * decide whether to fall through to the file/readline tiers:
   * when Telegram is engaged in CI, the file tier is dead-weight
   * (no human writes to `/tmp/<bank>-otp.txt` on a CI runner) and
   * the readline tier is non-TTY-skipped, so an empty result
   * means the run cannot deliver an OTP and must fail loud
   * immediately rather than burn another `timeoutMs` on a poll
   * that will never see a file.
   */
  readonly engaged: boolean;
  /** Captured digits, or empty string when the fetcher returned false. */
  readonly code: string;
}

/**
 * Try the Telegram OTP tier when opted-in and configured. Returns
 * an outcome that distinguishes the skip path (`engaged: false`)
 * from the run-to-completion path (`engaged: true`, with `code`
 * populated on match or empty on timeout / transport failure).
 *
 * @param args - Poller args (forward `bankRegex` + bankName + logger).
 * @param timeoutMs - Budget granted to the Telegram fetcher.
 * @returns Tier outcome.
 */
async function tryTelegramTier(
  args: ICreateOtpPollerArgs,
  timeoutMs: number,
): Promise<ITelegramTierOutcome> {
  if (!shouldEngageTelegramTier(args)) return { engaged: false, code: '' };
  const regex = args.bankRegex;
  if (!regex) return { engaged: false, code: '' };
  const bankName = args.bankName ?? '';
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  const result = await fetchOtpFromTelegram({
    botToken,
    chatId,
    bankName,
    bankRegex: regex,
    timeoutMs,
    log: args.log,
  });
  return { engaged: true, code: result === false ? '' : result };
}

/**
 * Build a no-arg OTP retriever bound to the given env var, poll
 * file basename, and (optional) per-bank Telegram regex. The
 * returned function is the shape expected by `ScraperCredentials`
 * (phone-hint is wrapped in via closure).
 *
 * @param args - bank-specific env var, poll file basename, logger,
 *   timeout, and optional bankRegex enabling the Telegram tier.
 * @returns `(hint?) => Promise<string>` retriever.
 */
function createOtpPoller(args: ICreateOtpPollerArgs): (hint?: string) => Promise<string> {
  const tmp = os.tmpdir();
  const filePath = path.join(tmp, args.fileName);
  const envVar = args.envVar;
  const log = args.log;
  const timeoutMs = args.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  return async (hint?: string): Promise<string> => {
    const phoneHint = hint ?? '';
    // Tier 1: env var (CI preset / local override).
    const fromEnv = process.env[envVar];
    if (fromEnv && fromEnv.length > 0) {
      log.info({ phoneHint: phoneHint || 'unknown', envVar }, `Using ${envVar} env var`);
      return fromEnv;
    }
    // Tier 2: Telegram bot (CI default; opt-in via bankRegex + env
    // vars). When engaged, Telegram consumes the FULL `timeoutMs`
    // budget — file/readline tiers are dead-weight in CI and a
    // fall-through would only waste another `timeoutMs` on a poll
    // that no one is going to satisfy.
    const tg = await tryTelegramTier(args, timeoutMs);
    if (tg.code.length > 0) return tg.code;
    if (tg.engaged) {
      throw new ScraperError(
        `Telegram OTP tier exhausted ${String(timeoutMs)}ms — no reply received (or transport failure). File/readline tiers skipped because Telegram was the configured channel.`,
      );
    }
    // Tier 3: poll file (interactive local).
    if (!process.stdin.isTTY) {
      return pollForCode({ filePath, log, phoneHint, timeoutMs });
    }
    // Tier 4: readline TTY.
    return promptViaReadline(phoneHint);
  };
}

/** Digits-only regex used by every bank — attribution comes from the
 *  Telegram reply-id, not from per-bank text matching. */
const DIGITS_ONLY_REGEX = /(\d{4,8})/;

/**
 * Factory wrapper around {@link createOtpPoller} that derives the
 * `envVar` (`<UPPER>_OTP`) and `fileName` (`<lower>-otp.txt`) from
 * the bank name, sets the standard `bankRegex`, and forwards the
 * `bankName` to the Telegram tier. Every E2E Real bank test that
 * needs OTP delivery uses this — saves ~6 lines per bank vs the
 * raw `createOtpPoller` form.
 *
 * @param bankName - Display name used in the Telegram prompt
 *   (e.g. "Beinleumi"). Becomes the env-var prefix (uppercased)
 *   and the poll-file basename (lowercased).
 * @param log - Pino-shaped logger.
 * @returns OTP retriever (`(hint?) => Promise<string>`).
 */
function createBankOtpPoller(
  bankName: string,
  log: ScraperLogger,
): (hint?: string) => Promise<string> {
  const upper = bankName.toUpperCase();
  const lower = bankName.toLowerCase();
  return createOtpPoller({
    envVar: `${upper}_OTP`,
    fileName: `${lower}-otp.txt`,
    log,
    bankName,
    bankRegex: DIGITS_ONLY_REGEX,
  });
}

export { createBankOtpPoller, createOtpPoller, DEFAULT_POLL_TIMEOUT_MS };
export default createOtpPoller;

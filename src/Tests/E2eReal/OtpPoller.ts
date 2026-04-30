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

const POLL_INTERVAL_MS = 1000;
/** Default OTP poll timeout — 2 minutes (user-typing budget). */
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

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
}

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
 * Build a no-arg OTP retriever bound to the given env var + poll file.
 * The returned function is the shape expected by ScraperCredentials
 * (phone-hint is wrapped in via closure).
 * @param args - bank-specific env var, poll file basename, logger, timeout
 * @returns () => Promise<string> retriever
 */
function createOtpPoller(args: ICreateOtpPollerArgs): (hint?: string) => Promise<string> {
  const tmp = os.tmpdir();
  const filePath = path.join(tmp, args.fileName);
  const envVar = args.envVar;
  const log = args.log;
  const timeoutMs = args.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  return async (hint?: string): Promise<string> => {
    const phoneHint = hint ?? '';
    const fromEnv = process.env[envVar];
    if (fromEnv && fromEnv.length > 0) {
      log.info({ phoneHint: phoneHint || 'unknown', envVar }, `Using ${envVar} env var`);
      return fromEnv;
    }
    if (!process.stdin.isTTY) {
      return pollForCode({ filePath, log, phoneHint, timeoutMs });
    }
    return promptViaReadline(phoneHint);
  };
}

export { createOtpPoller };
export default createOtpPoller;

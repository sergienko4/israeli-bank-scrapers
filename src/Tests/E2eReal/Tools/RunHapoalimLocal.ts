/**
 * RunHapoalimLocal — a test-only live runner for one Hapoalim scrape.
 *
 * <p>Loads the repo `.env`, reads the OTP through the shared poller ladder
 * (`HAPOALIM_OTP`, then `<os.tmpdir()>/hapoalim-otp.txt`, then a TTY
 * prompt), and caches `persistentOtpToken` in an owner-only file so a second
 * invocation can prove the warm path. The token is never printed: only its
 * length is logged.
 *
 * <p>Usage:
 *   npx tsx src/Tests/E2eReal/Tools/RunHapoalimLocal.ts --cold
 *   npx tsx src/Tests/E2eReal/Tools/RunHapoalimLocal.ts
 *   npx tsx src/Tests/E2eReal/Tools/RunHapoalimLocal.ts --token-file=/tmp/hp.token
 *
 * <p>Options: `--cold` ignores any cached token and `--token-file=<path>`
 * selects where the token is cached.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../../index.js';
import type { IScraperScrapingResult } from '../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { getDebug } from '../../../Scrapers/Pipeline/Logging/Debug.js';
import { defaultStartDate } from '../Helpers.js';
import { createOtpPoller } from '../OtpPoller.js';
import { makeTokenSaver, readToken } from './HapoalimLocalTokenCache.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const TMP_DIR = os.tmpdir();
const DEFAULT_TOKEN_FILE = path.join(TMP_DIR, 'hapoalim-token.cache');
const OTP_FILE = path.join(TMP_DIR, 'hapoalim-otp.txt');
const EXIT_FAILURE = 1;
const TOKEN_SETTLE_TIMEOUT_MS = 5_000;

/** Parsed command line. */
interface IArgs {
  readonly cold: boolean;
  readonly tokenFile: string;
}

/**
 * Read one `--name=value` option.
 * @param args - Raw arguments.
 * @param name - Option name without dashes.
 * @returns The value, or '' when absent.
 */
function optionOf(args: readonly string[], name: string): string {
  const prefix = `--${name}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return '';
}

/**
 * Parse the runner's arguments.
 * @param argv - Raw process arguments after the script.
 * @returns Parsed arguments.
 */
function parseArgs(argv: readonly string[]): IArgs {
  const tokenFile = optionOf(argv, 'token-file');
  return {
    cold: argv.includes('--cold'),
    tokenFile: tokenFile.length > 0 ? tokenFile : DEFAULT_TOKEN_FILE,
  };
}

/**
 * Require one non-empty environment value without echoing it.
 * @param name - Environment variable name.
 * @returns The value.
 */
function requireEnv(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (value.length === 0) {
    throw new ScraperError(`${name} is not set — fill it in .env`);
  }
  return value;
}

/**
 * Count transactions across the returned accounts.
 * @param result - Scrape result.
 * @returns Total transaction rows.
 */
function txnCountOf(result: IScraperScrapingResult): number {
  const accounts = result.accounts ?? [];
  return accounts.reduce((total, account): number => total + account.txns.length, 0);
}

/**
 * Describe one run without any value that identifies an account or session.
 * @param result - Scrape result.
 * @param warm - Whether the run started from a cached token.
 * @param elapsedMs - Wall-clock duration.
 * @returns The redacted summary text.
 */
function summaryOf(result: IScraperScrapingResult, warm: boolean, elapsedMs: number): string {
  const tokenLength = result.persistentOtpToken?.length ?? 0;
  const summary = {
    warm,
    success: result.success,
    errorType: result.errorType ?? '',
    errorMessage: result.errorMessage ?? '',
    accounts: result.accounts?.length ?? 0,
    transactions: txnCountOf(result),
    tokenLength,
    elapsedMs,
  };
  return JSON.stringify(summary, null, 2);
}

/**
 * Run one scrape and persist any published token.
 * @param args - Parsed command line.
 * @returns True for a successful scrape and a saved token.
 */
async function run(args: IArgs): Promise<boolean> {
  const userCode = requireEnv('HAPOALIM_USER_CODE');
  const password = requireEnv('HAPOALIM_PASSWORD');
  const cached = args.cold ? '' : await readToken(args.tokenFile);
  const signature = (process.env.HAPOALIM_DEVICE_SIGNATURE ?? '').trim();
  const tokenSaver = makeTokenSaver(args.tokenFile);
  const retrieve = createOtpPoller({
    envVar: 'HAPOALIM_OTP',
    fileName: 'hapoalim-otp.txt',
    log: LOG,
    perStep: true,
    bankName: 'Hapoalim',
    bankRegex: /(\d{4,8})/,
  });
  const scraper = createScraper({
    companyId: CompanyTypes.Hapoalim,
    startDate: defaultStartDate(),
    otpCodeRetriever: retrieve,
    onAuthFlowComplete: tokenSaver.save,
  });
  const creds = {
    userCode,
    password,
    ...(cached.length > 0 ? { otpLongTermToken: cached } : {}),
    ...(signature.length > 0 ? { deviceSignature: signature } : {}),
  };
  LOG.info(
    {
      warm: cached.length > 0,
      tokenLength: cached.length,
      tokenFile: args.tokenFile,
      otpFile: OTP_FILE,
    },
    'Starting Hapoalim local run',
  );
  const started = Date.now();
  const result = await scraper.scrape(creds);
  const elapsedMs = Date.now() - started;
  const summary = summaryOf(result, cached.length > 0, elapsedMs);
  console.log(summary);
  const saveFailure = await tokenSaver.settle(TOKEN_SETTLE_TIMEOUT_MS);
  if (saveFailure.length > 0) {
    console.error(saveFailure);
    return false;
  }
  return result.success;
}

/**
 * Entry point.
 * @returns Nothing; exits non-zero on failure.
 */
async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  try {
    const isSuccessful = await run(args);
    if (!isSuccessful) process.exitCode = EXIT_FAILURE;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();

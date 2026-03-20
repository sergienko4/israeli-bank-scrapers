#!/usr/bin/env node
/**
 * Run a real scrape for OTP-enabled banks with interactive OTP input.
 * ALL output captured to C:/tmp/scrape-<bank>.log via pino file destination.
 *
 * Usage:
 *   npx tsx scripts/run-otp-bank.ts beinleumi
 *   npx tsx scripts/run-otp-bank.ts onezero
 *   npx tsx scripts/run-otp-bank.ts beinleumi onezero   (both sequentially)
 */
import * as fs from 'node:fs';
import * as readline from 'node:readline';

// Pino writes to a log file via PINO_LOG_FILE (multistream in Debug.ts).
// CI=1 disables pino-pretty worker thread so JSON goes to stdout + file.
process.env.LOG_LEVEL = 'trace';
process.env.NODE_ENV = 'production';
process.env.CI = '1';
process.env.PINO_LOG_FILE = 'C:/tmp/scrape-pino.log';

// Load .env for credentials (before dynamic imports)
const dotenv = await import('dotenv');
dotenv.config();

// ── Verify CI=1 took effect ──────────────────────────────────────────────────
// Debug.ts checks: !process.env.CI && NODE_ENV !== 'production'
// With CI=1 OR NODE_ENV=production, isDevMode=false → no pino-pretty transport
// pino writes raw JSON to stdout → we can intercept it.

const bankArgs = process.argv.slice(2).map(a => a.toLowerCase());
const VALID_BANKS = ['beinleumi', 'onezero', 'visacal'];
const banks = bankArgs.filter(a => VALID_BANKS.includes(a));

if (banks.length === 0) {
  console.error(`Usage: npx tsx scripts/run-otp-bank.ts <${VALID_BANKS.join('|')}> [...]`);
  process.exit(1);
}

/** Prompt the user for OTP code via stdin. */
function askOtp(phoneHint: string): Promise<string> {
  const hint = phoneHint || 'your phone';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n🔐 Enter OTP code sent to ${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Build credentials for a given bank from env vars. */
function getCredentials(bank: string): Record<string, unknown> {
  if (bank === 'beinleumi') {
    return {
      username: process.env.BEINLEUMI_USERNAME ?? '',
      password: process.env.BEINLEUMI_PASSWORD ?? '',
    };
  }
  if (bank === 'visacal') {
    return {
      username: process.env.VISACAL_USERNAME ?? '',
      password: process.env.VISACAL_PASSWORD ?? '',
    };
  }
  return {
    email: process.env.ONEZERO_EMAIL ?? '',
    password: process.env.ONEZERO_PASSWORD ?? '',
    phoneNumber: process.env.ONEZERO_PHONE_NUMBER ?? '',
    otpCodeRetriever: () => askOtp(process.env.ONEZERO_PHONE_NUMBER ?? ''),
  };
}

const LEVEL_NAMES: Record<number, string> = {
  10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL',
};

/** Format a pino JSON line into a readable console string. */
function formatPinoLine(json: string): string {
  try {
    const obj = JSON.parse(json);
    const time = obj.time ? new Date(obj.time).toISOString().slice(11, 23) : '';
    const level = LEVEL_NAMES[obj.level] ?? String(obj.level);
    const mod = obj.module ? `[${obj.module}]` : '';
    const bank = obj.bank ? `(${obj.bank})` : '';
    const msg = obj.msg ?? '';
    return `${time} ${level.padEnd(5)} ${mod} ${bank} ${msg}`;
  } catch {
    return json;
  }
}

/** Install stdout/stderr tee to a file. Returns cleanup function. */
function installTee(logPath: string): () => void {
  const fd = fs.openSync(logPath, 'a');
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    fs.writeSync(fd, text);
    // Pretty-print pino JSON for console
    if (text.trimStart().startsWith('{') && text.includes('"level"')) {
      const pretty = formatPinoLine(text.trim());
      return origStdout(pretty + '\n');
    }
    return origStdout(chunk, ...args);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    fs.writeSync(fd, text);
    return origStderr(chunk, ...args);
  }) as typeof process.stderr.write;

  return () => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    fs.closeSync(fd);
  };
}

// Verify env vars are set before import
console.log(`[setup] CI=${process.env.CI} NODE_ENV=${process.env.NODE_ENV} LOG_LEVEL=${process.env.LOG_LEVEL}`);

// Dynamic import AFTER env vars — Debug.ts reads process.env at module init
const { createScraper } = await import('../src/index.js');
const { CompanyTypes } = await import('../src/Definitions.js');

const BANK_MAP: Record<string, string> = {
  beinleumi: CompanyTypes.Beinleumi,
  onezero: CompanyTypes.OneZero,
  visacal: CompanyTypes.VisaCal,
};

for (const bank of banks) {
  const logPath = `C:/tmp/scrape-${bank}.log`;
  fs.writeFileSync(logPath, `=== ${bank} scrape started at ${new Date().toISOString()} ===\n`);
  const cleanup = installTee(logPath);
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    console.log(`\n🏦 Scraping ${bank} (last 30 days from ${startDate.toISOString().slice(0, 10)})`);
    console.log(`📄 Full trace log: ${logPath}\n`);

    const credentials = getCredentials(bank);
    const missingKeys = Object.entries(credentials).filter(([, v]) => !v).map(([k]) => k);
    if (missingKeys.length > 0) {
      console.error(`❌ Missing env vars for ${bank}: ${missingKeys.join(', ')}`);
      continue;
    }

    const scraper = createScraper({
      companyId: BANK_MAP[bank] as never,
      startDate,
      shouldShowBrowser: true,
      otpCodeRetriever: askOtp,
    });

    const result = await scraper.scrape(credentials);

    if (result.success) {
      console.log(`\n✅ ${bank} — Success! ${result.accounts?.length ?? 0} account(s)\n`);
      for (const account of result.accounts ?? []) {
        console.log(`  📋 Account: ${account.accountNumber} (${account.txns.length} txns)`);
        for (const txn of account.txns.slice(0, 15)) {
          const date = txn.date ? new Date(txn.date).toLocaleDateString('he-IL') : '?';
          const amount = String(txn.chargedAmount ?? txn.originalAmount ?? 0);
          const currency = txn.originalCurrency ?? '';
          const desc = txn.description ?? txn.memo ?? '—';
          console.log(`    ${date.padEnd(12)} ${amount.padStart(10)} ${currency.padEnd(4)} ${desc}`);
        }
        if (account.txns.length > 15) {
          console.log(`    ... and ${account.txns.length - 15} more`);
        }
        console.log('');
      }
    } else {
      console.error(`\n❌ ${bank} — Failed: ${result.errorType} — ${result.errorMessage}\n`);
    }

    console.log(`\n=== ${bank} scrape finished at ${new Date().toISOString()} ===`);
    console.log(`📄 Full trace log saved: ${logPath}\n`);
  } finally {
    cleanup();
  }
}

process.exit(0);

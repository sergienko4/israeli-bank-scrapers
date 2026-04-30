/**
 * Ad-hoc E2E runner — full unmasked output, 90 days, trace logs.
 * Usage: LOG_LEVEL=trace npx tsx C:\tmp\e2e-runner.ts <discount|visaCal|isracard>
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { CompanyTypes, createScraper } from './src/index.js';
import type { IScraperScrapingResult } from './src/Scrapers/Base/Interface.js';
import type { ITransaction, ITransactionsAccount } from './src/Transactions.js';

/** 90 days ago. */
const START_DATE = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

/** Bank credential mappings. */
const BANK_CREDS: Record<string, { companyId: CompanyTypes; creds: Record<string, string> }> = {
  discount: {
    companyId: CompanyTypes.Discount,
    creds: {
      id: process.env.DISCOUNT_ID ?? '',
      password: process.env.DISCOUNT_PASSWORD ?? '',
      num: process.env.DISCOUNT_NUM ?? '',
    },
  },
  visaCal: {
    companyId: CompanyTypes.VisaCal,
    creds: {
      username: process.env.VISACAL_USERNAME ?? '',
      password: process.env.VISACAL_PASSWORD ?? '',
    },
  },
  isracard: {
    companyId: CompanyTypes.Isracard,
    creds: {
      id: process.env.ISRACARD_ID ?? '',
      card6Digits: process.env.ISRACARD_CARD6DIGITS ?? '',
      password: process.env.ISRACARD_PASSWORD ?? '',
    },
  },
  amex: {
    companyId: CompanyTypes.Amex,
    creds: {
      id: process.env.AMEX_ID ?? '',
      card6Digits: process.env.AMEX_CARD6DIGITS ?? '',
      password: process.env.AMEX_PASSWORD ?? '',
    },
  },
  max: {
    companyId: CompanyTypes.Max,
    creds: {
      username: process.env.MAX_USERNAME ?? '',
      password: process.env.MAX_PASSWORD ?? '',
    },
  },
};

/** Format amount with sign. */
function fmtAmount(n: number | undefined): string {
  if (n == null) return '—';
  return n.toFixed(2);
}

/** Format date to YYYY-MM-DD. */
function fmtDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

/** Print full transaction table for one account. */
function printAccount(account: ITransactionsAccount, idx: number): void {
  const acct = account.accountNumber;
  const count = account.txns.length;
  const bal = account.balance != null ? fmtAmount(account.balance) : '—';
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Account #${idx + 1}: ${acct} | Balance: ${bal} | Transactions: ${count}`);
  console.log('='.repeat(80));
  if (count === 0) {
    console.log('  (no transactions)');
    return;
  }
  console.log(
    `${'#'.padEnd(5)}${'Date'.padEnd(13)}${'Amount'.padStart(12)}  ${'Currency'.padEnd(5)} ${'Description'.padEnd(40)} ${'Status'.padEnd(10)} ${'Type'}`,
  );
  console.log('-'.repeat(100));
  account.txns.forEach((txn: ITransaction, i: number) => {
    const num = String(i + 1).padEnd(5);
    const date = fmtDate(txn.date).padEnd(13);
    const amount = fmtAmount(txn.originalAmount).padStart(12);
    const currency = (txn.originalCurrency ?? '').padEnd(5);
    const desc = (txn.description ?? '').padEnd(40);
    const status = (txn.status ?? '').padEnd(10);
    const type = txn.type ?? '';
    console.log(`${num}${date}${amount}  ${currency} ${desc} ${status} ${type}`);
  });
}

/** Print full result. */
function printResult(bankName: string, result: IScraperScrapingResult): void {
  console.log(`\n${'#'.repeat(80)}`);
  console.log(`# E2E RESULT: ${bankName}`);
  console.log(`# success: ${result.success}`);
  if (!result.success) {
    console.log(`# errorType: ${result.errorType ?? '—'}`);
    console.log(`# errorMessage: ${result.errorMessage ?? '—'}`);
  }
  console.log(`# accounts: ${result.accounts?.length ?? 0}`);
  console.log('#'.repeat(80));

  if (!result.accounts) return;
  result.accounts.forEach((account, idx) => printAccount(account, idx));

  // Summary
  const totalTxns = result.accounts.reduce((sum, a) => sum + a.txns.length, 0);
  console.log(`\n--- SUMMARY: ${result.accounts.length} accounts, ${totalTxns} total transactions ---`);
}

/** Main. */
async function main(): Promise<void> {
  const bankKey = process.argv[2];
  if (!bankKey || !BANK_CREDS[bankKey]) {
    console.error(`Usage: npx tsx e2e-runner.ts <${Object.keys(BANK_CREDS).join('|')}>`);
    process.exit(1);
  }
  const { companyId, creds } = BANK_CREDS[bankKey];
  console.log(`\n>>> Starting E2E: ${bankKey} | startDate: ${START_DATE.toISOString().slice(0, 10)} | LOG_LEVEL: ${process.env.LOG_LEVEL ?? 'info'}\n`);

  const scraper = createScraper({
    companyId,
    startDate: START_DATE,
    shouldShowBrowser: false,
  });

  const result = await scraper.scrape(creds);
  printResult(bankKey, result);

  // Write JSON result for post-processing
  const fs = await import('fs');
  const outPath = `C:\\tmp\\e2e-${bankKey}-result.json`;
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nJSON result saved to: ${outPath}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

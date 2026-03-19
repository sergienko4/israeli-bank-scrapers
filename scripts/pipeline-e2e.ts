/**
 * Real E2E test — runs Discount + VisaCal through the new Pipeline architecture.
 * Usage: npx tsx scripts/pipeline-e2e.ts
 */

import 'dotenv/config';

import { CompanyTypes } from '../src/Definitions.js';
import createScraper from '../src/Scrapers/Registry/Factory.js';

const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

/**
 * Run a scraper through the pipeline and print results.
 * @param bankName - Display name.
 * @param companyId - CompanyTypes enum.
 * @param credentials - Bank credentials.
 */
async function runBank(
  bankName: string,
  companyId: CompanyTypes,
  credentials: Record<string, string>,
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${bankName} — Pipeline E2E`);
  console.log(`${'='.repeat(60)}\n`);

  const scraper = createScraper({
    companyId,
    startDate: NINETY_DAYS_AGO,
    usePipeline: true,
  });

  try {
    const result = await scraper.scrape(credentials);
    console.log(`Success: ${String(result.success)}`);

    if (!result.success) {
      console.log(`Error: ${result.errorType} — ${result.errorMessage}`);
      return;
    }

    const accounts = result.accounts ?? [];
    console.log(`Accounts: ${String(accounts.length)}`);

    for (const account of accounts) {
      console.log(`\n  Account: ${account.accountNumber}`);
      console.log(`  Balance: ${String(account.balance ?? 'N/A')}`);
      console.log(`  Transactions: ${String(account.txns.length)}`);

      const recent = account.txns.slice(0, 5);
      for (const txn of recent) {
        const date = new Date(txn.date).toLocaleDateString('he-IL');
        const amount = txn.chargedAmount.toFixed(2);
        console.log(`    ${date} | ${amount} | ${txn.description}`);
      }
      if (account.txns.length > 5) {
        const remaining = account.txns.length - 5;
        console.log(`    ... and ${String(remaining)} more`);
      }
    }
  } catch (error) {
    console.error(`CRASHED: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const discountId = process.env['DISCOUNT_ID'] ?? '';
  const discountPw = process.env['DISCOUNT_PASSWORD'] ?? '';
  const discountNum = process.env['DISCOUNT_NUM'] ?? '';

  if (discountId && discountPw && discountNum) {
    await runBank('Discount', CompanyTypes.Discount, {
      id: discountId,
      password: discountPw,
      num: discountNum,
    });
  } else {
    console.log('Skipping Discount — missing DISCOUNT_ID/PASSWORD/NUM in .env');
  }

  const visaCalUser = process.env['VISACAL_USERNAME'] ?? '';
  const visaCalPw = process.env['VISACAL_PASSWORD'] ?? '';

  if (visaCalUser && visaCalPw) {
    await runBank('VisaCal', CompanyTypes.VisaCal, {
      username: visaCalUser,
      password: visaCalPw,
    });
  } else {
    console.log('Skipping VisaCal — missing VISACAL_USERNAME/PASSWORD in .env');
  }
}

main().catch(console.error);

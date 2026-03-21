/**
 * Run OLD Discount scraper (no pipeline) with full trace.
 */
import 'dotenv/config';

import { CompanyTypes } from '../src/Definitions.js';
import createScraper from '../src/Scrapers/Registry/Factory.js';

async function main(): Promise<void> {
  const id = process.env['DISCOUNT_ID'] ?? '';
  const password = process.env['DISCOUNT_PASSWORD'] ?? '';
  const num = process.env['DISCOUNT_NUM'] ?? '';

  if (!id || !password || !num) {
    console.log('Missing DISCOUNT_ID/PASSWORD/NUM in .env');
    return;
  }

  console.log('=== OLD Discount (usePipeline: false) ===');
  const scraper = createScraper({
    companyId: CompanyTypes.Discount,
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    // usePipeline NOT set — uses old GenericBankScraper
  });

  const result = await scraper.scrape({ id, password, num });
  console.log(`Success: ${String(result.success)}`);
  if (!result.success) {
    console.log(`Error: ${result.errorType} — ${result.errorMessage}`);
    return;
  }
  const accounts = result.accounts ?? [];
  console.log(`Accounts: ${String(accounts.length)}`);
  for (const acct of accounts) {
    console.log(`  ${acct.accountNumber}: ${String(acct.txns.length)} txns, balance: ${String(acct.balance)}`);
    for (const txn of acct.txns.slice(0, 3)) {
      const d = new Date(txn.date).toLocaleDateString('he-IL');
      const amt = txn.chargedAmount?.toFixed(2) ?? 'N/A';
      console.log(`    ${d} | ${amt} | ${txn.description}`);
    }
  }
}

main().catch(console.error);

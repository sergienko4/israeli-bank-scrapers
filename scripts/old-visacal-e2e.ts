/**
 * Run OLD VisaCal scraper (no pipeline) with full trace.
 */
import 'dotenv/config';

import { CompanyTypes } from '../src/Definitions.js';
import createScraper from '../src/Scrapers/Registry/Factory.js';

async function main(): Promise<void> {
  const username = process.env['VISACAL_USERNAME'] ?? '';
  const password = process.env['VISACAL_PASSWORD'] ?? '';

  if (!username || !password) {
    console.log('Missing VISACAL_USERNAME/PASSWORD in .env');
    return;
  }

  console.log('=== OLD VisaCal (usePipeline: false) ===');
  const scraper = createScraper({
    companyId: CompanyTypes.VisaCal,
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    // usePipeline NOT set — uses old GenericBankScraper
  });

  const result = await scraper.scrape({ username, password });
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
      console.log(`    ${d} | ${txn.chargedAmount.toFixed(2)} | ${txn.description}`);
    }
  }
}

main().catch(console.error);

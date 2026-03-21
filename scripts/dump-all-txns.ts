/**
 * Dump ALL transactions from Discount + VisaCal pipeline E2E (last 90 days).
 * Writes to C:/tmp/all-txns.txt to avoid stdout debug noise.
 * Usage: npx tsx scripts/dump-all-txns.ts
 */

import 'dotenv/config';

import * as fs from 'node:fs';

import { CompanyTypes } from '../src/Definitions.js';
import type { IScraperScrapingResult } from '../src/Scrapers/Base/Interface.js';
import createScraper from '../src/Scrapers/Registry/Factory.js';

const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
const OUT = 'C:/tmp/all-txns.txt';
const lines: string[] = [];

/**
 * Format one bank's results into lines.
 * @param bankName - Display name.
 * @param result - Scraper result.
 */
function formatBank(bankName: string, result: IScraperScrapingResult): void {
  lines.push(`\n${'='.repeat(60)}`);
  lines.push(`  ${bankName} — success=${String(result.success)}`);
  lines.push(`${'='.repeat(60)}`);
  if (!result.success) {
    lines.push(`  ERROR: ${result.errorType} — ${result.errorMessage}`);
    return;
  }
  for (const a of result.accounts ?? []) {
    lines.push(`\n  Account: ${a.accountNumber} | Balance: ${String(a.balance ?? 'N/A')} | Txns: ${String(a.txns.length)}`);
    lines.push('  ' + '-'.repeat(75));
    for (const t of a.txns) {
      const d = new Date(t.date).toLocaleDateString('he-IL');
      const amt = String(t.chargedAmount ?? 0).padStart(10);
      const st = (t.status ?? '').padEnd(10);
      lines.push(`  ${d} | ${amt} | ${st} | ${t.description}`);
    }
  }
}

async function main(): Promise<void> {
  const discountId = process.env['DISCOUNT_ID'] ?? '';
  const discountPw = process.env['DISCOUNT_PASSWORD'] ?? '';
  const discountNum = process.env['DISCOUNT_NUM'] ?? '';
  if (discountId && discountPw && discountNum) {
    const s = createScraper({ companyId: CompanyTypes.Discount, startDate: NINETY_DAYS_AGO, usePipeline: true });
    const r = await s.scrape({ id: discountId, password: discountPw, num: discountNum });
    formatBank('Discount', r);
  }

  const vcUser = process.env['VISACAL_USERNAME'] ?? '';
  const vcPw = process.env['VISACAL_PASSWORD'] ?? '';
  if (vcUser && vcPw) {
    const s = createScraper({ companyId: CompanyTypes.VisaCal, startDate: NINETY_DAYS_AGO, usePipeline: true });
    const r = await s.scrape({ username: vcUser, password: vcPw });
    formatBank('VisaCal', r);
  }

  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`Written ${String(lines.length)} lines to ${OUT}`);
}

main().catch((e: Error) => {
  fs.writeFileSync(OUT, `CRASH: ${e.message}\n${e.stack ?? ''}`);
});

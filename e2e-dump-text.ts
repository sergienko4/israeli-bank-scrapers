/**
 * Diagnostic: dump ALL visible clickable text on the dashboard after login.
 * Usage: LOG_LEVEL=trace node_modules/.bin/tsx e2e-dump-text.ts <bank>
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { CompanyTypes, createScraper } from './src/index.js';

const BANK_CREDS: Record<string, { companyId: CompanyTypes; creds: Record<string, string> }> = {
  visaCal: {
    companyId: CompanyTypes.VisaCal,
    creds: { username: process.env.VISACAL_USERNAME ?? '', password: process.env.VISACAL_PASSWORD ?? '' },
  },
  max: {
    companyId: CompanyTypes.Max,
    creds: { username: process.env.MAX_USERNAME ?? '', password: process.env.MAX_PASSWORD ?? '' },
  },
};

const bankKey = process.argv[2];
if (!bankKey || !BANK_CREDS[bankKey]) {
  console.error(`Usage: npx tsx e2e-dump-text.ts <${Object.keys(BANK_CREDS).join('|')}>`);
  process.exit(1);
}

const { companyId, creds } = BANK_CREDS[bankKey];

console.log(`\n>>> Dumping visible text for: ${bankKey}\n`);

const scraper = createScraper({
  companyId,
  startDate: new Date(),
  shouldShowBrowser: true,
});

const result = await scraper.scrape(creds);
console.log(`\nResult: success=${result.success}, error=${result.errorMessage ?? 'none'}`);

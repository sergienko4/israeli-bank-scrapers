/**
 * Interactive Beinleumi scraper — opens a real browser window.
 * When the OTP screen appears, write your code to .beinleumi-otp.tmp
 * (this script polls that file every 500ms).
 *
 * Usage:
 *   npx ts-node scripts/run-beinleumi.ts
 *
 * In a second terminal, when prompted:
 *   echo 123456 > .beinleumi-otp.tmp
 */
// Enable debug output from the OTP detector/handler modules
process.env.DEBUG = 'otp-detector,otp-handler,selector-resolver';

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createScraper, CompanyTypes } from '../src/index';

dotenv.config();

const OTP_FILE = path.join(process.cwd(), '.beinleumi-otp.tmp');
const POLL_MS = 500;

function cleanOtpFile() {
  if (fs.existsSync(OTP_FILE)) fs.unlinkSync(OTP_FILE);
}

async function waitForOtpFromFile(phoneHint: string): Promise<string> {
  cleanOtpFile();
  console.log('\n========================================');
  console.log('📱  OTP SCREEN DETECTED');
  console.log(`    Phone hint: ${phoneHint || '(none shown)'}`);
  console.log('    Check your SMS. When you have the code:');
  console.log(`    → Tell Claude the code, or run:`);
  console.log(`      echo YOUR_CODE > .beinleumi-otp.tmp`);
  console.log('========================================\n');

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5 * 60 * 1000; // 5 min timeout
    const interval = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error('OTP timeout — no code provided within 5 minutes'));
        return;
      }
      if (!fs.existsSync(OTP_FILE)) return;
      const code = fs.readFileSync(OTP_FILE, 'utf-8').trim();
      if (!code) return;
      clearInterval(interval);
      cleanOtpFile();
      console.log(`[OTP] Using code: ${code}`);
      resolve(code);
    }, POLL_MS);
  });
}

async function main() {
  const username = process.env.BEINLEUMI_USERNAME;
  const password = process.env.BEINLEUMI_PASSWORD;
  if (!username || !password) {
    console.error('❌  Missing BEINLEUMI_USERNAME or BEINLEUMI_PASSWORD in .env');
    process.exit(1);
  }

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);

  console.log('🚀  Starting Beinleumi scraper (browser will open)…');

  const screenshotDir = path.join(process.cwd(), '.beinleumi-debug');
  fs.mkdirSync(screenshotDir, { recursive: true });
  console.log(`    Screenshots saved to: ${screenshotDir}`);

  const scraper = createScraper({
    companyId: CompanyTypes.beinleumi,
    startDate,
    showBrowser: true,
    storeFailureScreenShotPath: path.join(screenshotDir, 'failure.png'),
    otpCodeRetriever: waitForOtpFromFile,
    preparePage: async page => {
      // Log every URL change so we can see where the browser navigates
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) {
          console.log(`[NAV] → ${frame.url()}`);
        }
      });
    },
  });

  const result = await scraper.scrape({ username, password });

  if (result.success) {
    console.log('\n✅  Scrape succeeded!');
    const accounts = result.accounts ?? [];
    console.log(`    Accounts: ${accounts.length}`);
    for (const acc of accounts) {
      console.log(`    - ${acc.accountNumber}: ${acc.txns.length} transactions`);
    }
  } else {
    console.error('\n❌  Scrape failed:');
    console.error(`    errorType:    ${result.errorType}`);
    console.error(`    errorMessage: ${result.errorMessage}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

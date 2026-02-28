/**
 * Interactive OneZero scraper — pure REST API (no browser).
 *
 * Flow:
 *   1. login() calls triggerTwoFactorAuth(phoneNumber) → SMS sent automatically
 *   2. otpCodeRetriever() is called — write the code to .onezero-otp.tmp
 *   3. getLongTermTwoFactorToken(code) verifies it
 *   4. fetchData() scrapes transactions via GraphQL
 *
 * On success, prints the persistentOtpToken — save it to reuse without OTP next time.
 *
 * Usage:
 *   npx ts-node scripts/run-onezero.ts
 *
 * When prompted, run in a second terminal:
 *   echo YOUR_CODE > .onezero-otp.tmp
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createScraper, CompanyTypes } from '../src/index';

dotenv.config();

const OTP_FILE = path.join(process.cwd(), '.onezero-otp.tmp');
const POLL_MS = 500;

function cleanOtpFile() {
  if (fs.existsSync(OTP_FILE)) fs.unlinkSync(OTP_FILE);
}

async function waitForOtpFromFile(): Promise<string> {
  cleanOtpFile();
  console.log('\n========================================');
  console.log('📱  SMS SENT to', process.env.ONEZERO_PHONE_NUMBER);
  console.log('    When you have the code:');
  console.log(`    → Tell Claude the code, or run:`);
  console.log(`      echo YOUR_CODE > .onezero-otp.tmp`);
  console.log('========================================\n');

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5 * 60 * 1000;
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
  const email = process.env.ONEZERO_EMAIL;
  const password = process.env.ONEZERO_PASSWORD;
  const phoneNumber = process.env.ONEZERO_PHONE_NUMBER;
  const otpLongTermToken = process.env.ONEZERO_OTP_LONG_TERM_TOKEN;

  if (!email || !password) {
    console.error('❌  Missing ONEZERO_EMAIL or ONEZERO_PASSWORD in .env');
    process.exit(1);
  }

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 4);

  // Build credentials — use long-term token if available (skips SMS)
  const credentials = otpLongTermToken
    ? { email, password, otpLongTermToken }
    : (() => {
        if (!phoneNumber) {
          console.error('❌  Missing ONEZERO_PHONE_NUMBER (required when no ONEZERO_OTP_LONG_TERM_TOKEN)');
          process.exit(1);
        }
        return { email, password, phoneNumber, otpCodeRetriever: waitForOtpFromFile };
      })();

  console.log('🚀  Starting OneZero scraper (API only, no browser)…');
  if (otpLongTermToken) {
    console.log('    Using saved OTP token — no SMS needed');
  } else {
    console.log(`    Sending SMS to: ${phoneNumber}`);
  }

  const scraper = createScraper({ companyId: CompanyTypes.oneZero, startDate });
  const result = await scraper.scrape(credentials);

  if (result.success) {
    console.log('\n✅  Scrape succeeded!');
    const accounts = result.accounts ?? [];
    console.log(`    Accounts: ${accounts.length}`);
    for (const acc of accounts) {
      console.log(`\n  Account: ${acc.accountNumber}  balance: ${acc.balance} ILS`);
      console.log(`  Transactions (${acc.txns.length}):`);
      for (const t of acc.txns) {
        const sign = t.chargedAmount >= 0 ? '+' : '';
        const date = t.date.slice(0, 10);
        console.log(`    ${date}  ${sign}${t.chargedAmount} ${t.chargedCurrency}  ${t.description}`);
      }
    }
    if (result.persistentOtpToken) {
      console.log('\n💾  Save this token to skip OTP next time (add to .env):');
      console.log(`    ONEZERO_OTP_LONG_TERM_TOKEN=${result.persistentOtpToken}`);
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

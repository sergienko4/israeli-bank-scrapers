/**
 * Standalone E2E runner — shows pino logs to diagnose hang.
 */
import * as dotenv from 'dotenv';

dotenv.config();

import * as readline from 'readline';

import { CompanyTypes, createScraper } from './src/index.js';

/** Prompt user for OTP code via console. */
function promptOtp(phoneHint: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const hint = phoneHint || 'no hint';
  return new Promise((resolve) => {
    rl.question(`\n>>> OTP code (phone: ${hint}): `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Banks that require OTP. */
const OTP_BANKS = new Set(['beinleumi', 'hapoalim']);

const BANK = (process.argv[2] ?? 'discount') as string;
const START_DATE = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

const BANK_MAP: Record<string, { company: CompanyTypes; creds: Record<string, string> }> = {
  max: {
    company: CompanyTypes.Max,
    creds: {
      username: process.env.MAX_USERNAME ?? '',
      password: process.env.MAX_PASSWORD ?? '',
    },
  },
  discount: {
    company: CompanyTypes.Discount,
    creds: {
      id: process.env.DISCOUNT_ID ?? '',
      password: process.env.DISCOUNT_PASSWORD ?? '',
      num: process.env.DISCOUNT_NUM ?? '',
    },
  },
  isracard: {
    company: CompanyTypes.Isracard,
    creds: {
      id: process.env.ISRACARD_ID ?? '',
      card6Digits: process.env.ISRACARD_CARD6DIGITS ?? '',
      password: process.env.ISRACARD_PASSWORD ?? '',
    },
  },
  amex: {
    company: CompanyTypes.Amex,
    creds: {
      id: process.env.AMEX_ID ?? '',
      card6Digits: process.env.AMEX_CARD6DIGITS ?? '',
      password: process.env.AMEX_PASSWORD ?? '',
    },
  },
  visacal: {
    company: CompanyTypes.VisaCal,
    creds: {
      username: process.env.VISACAL_USERNAME ?? '',
      password: process.env.VISACAL_PASSWORD ?? '',
    },
  },
  beinleumi: {
    company: CompanyTypes.Beinleumi,
    creds: {
      username: process.env.BEINLEUMI_USERNAME ?? '',
      password: process.env.BEINLEUMI_PASSWORD ?? '',
    },
  },
  hapoalim: {
    company: CompanyTypes.Hapoalim,
    creds: {
      userCode: process.env.POALIM_USERNAME ?? '',
      password: process.env.POALIM_PASSWORD ?? '',
    },
  },
};

const bankConfig = BANK_MAP[BANK];
if (!bankConfig) { console.error(`Unknown bank: ${BANK}`); process.exit(1); }

const needsOtp = OTP_BANKS.has(BANK);
const scraper = createScraper({
  companyId: bankConfig.company,
  startDate: START_DATE,
  futureMonthsToScrape: 1,
  shouldShowBrowser: false,
  ...(needsOtp && { otpCodeRetriever: promptOtp }),
});

const creds = bankConfig.creds;

async function main(): Promise<void> {
  console.log(`\n>>> ${BANK} pipeline | startDate: ${START_DATE.toISOString().slice(0, 10)}\n`);

  const t0 = Date.now();
  const result = await scraper.scrape(creds as any);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n>>> DONE in ${elapsed}s`);
  console.log(`success: ${result.success}`);
  console.log(`errorType: ${result.errorType ?? 'none'}`);
  console.log(`errorMessage: ${result.errorMessage ?? 'none'}`);
  console.log(`accounts: ${result.accounts?.length ?? 0}`);

  if (result.accounts) {
    for (const acct of result.accounts) {
      console.log(`\nAccount: ${acct.accountNumber} | Txns: ${acct.txns.length}`);
      for (const txn of acct.txns) {
        console.log(`  ${txn.date?.slice(0, 10)} | ${txn.originalAmount} ${txn.originalCurrency} | ${txn.description}`);
      }
    }
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

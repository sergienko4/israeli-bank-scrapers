/**
 * Phase H — single source of truth for per-bank URL + frame +
 * OTP-usage scenarios consumed by the full-flow factory and per-
 * phase factories. Centralising the table here removes per-test
 * literal drift (CodeRabbit 2026-05-16 finding #15) so renaming a
 * bank's URL set is a one-line change.
 *
 * <p>All URLs use the `.example` reserved TLD per the locked PII
 * rule (H-D5). Cookie counts + frame counts are the captured-shape
 * observations for each bank's last-good run; OTP-usage matches
 * the captured-run evidence under `C:/tmp/runs/pipeline/<bank>/`.
 */

import type { PhaseHBank } from './_makePhaseFixture.js';

/** Per-bank scenario row shared across full-flow + per-phase tests. */
export interface IBankScenario {
  readonly bank: PhaseHBank;
  readonly homepageUrl: string;
  readonly postNavUrl: string;
  readonly loginUrl: string;
  readonly dashboardUrl: string;
  readonly accountsUrl: string;
  readonly frameCount: number;
  readonly usesOtp: boolean;
  /** Cookie count observed in the captured run for OTP-FILL FINAL audit. */
  readonly cookieCount: number;
}

/** Fixed phone-hint redaction reused by every OTP-using scenario. */
export const REDACTED_PHONE_HINT = 'XXX-XXX-FAKE';

/** Generic FAKE-redacted account number for SCRAPE replay. */
export const FAKE_ACCOUNT_NUMBER = 'FAKE-000000';

/** Per-bank scenarios for the full-flow + factory tests. */
export const BANK_SCENARIOS: readonly IBankScenario[] = [
  {
    bank: 'hapoalim',
    homepageUrl: 'https://www.bankhapoalim.example/',
    postNavUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
    loginUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
    dashboardUrl: 'https://login.bankhapoalim.example/ng-portals/dashboard',
    accountsUrl: 'https://login.bankhapoalim.example/ServerServices/general/accounts',
    frameCount: 2,
    usesOtp: true,
    cookieCount: 4,
  },
  {
    bank: 'beinleumi',
    homepageUrl: 'https://www.beinleumi.example/',
    postNavUrl: 'https://login.beinleumi.example/login',
    loginUrl: 'https://login.beinleumi.example/login',
    dashboardUrl: 'https://login.beinleumi.example/dashboard',
    accountsUrl: 'https://login.beinleumi.example/api/accounts',
    frameCount: 0,
    usesOtp: true,
    cookieCount: 3,
  },
  {
    bank: 'discount',
    homepageUrl: 'https://www.discount.example/',
    postNavUrl: 'https://start.telebank.example/auth',
    loginUrl: 'https://start.telebank.example/auth',
    dashboardUrl: 'https://start.telebank.example/dashboard',
    accountsUrl: 'https://start.telebank.example/api/accounts',
    frameCount: 0,
    usesOtp: false,
    cookieCount: 0,
  },
  {
    bank: 'amex',
    homepageUrl: 'https://www.amex.example/',
    postNavUrl: 'https://digital.amex.example/login',
    loginUrl: 'https://digital.amex.example/login',
    dashboardUrl: 'https://digital.amex.example/account',
    accountsUrl: 'https://digital.amex.example/api/accounts',
    frameCount: 0,
    usesOtp: false,
    cookieCount: 0,
  },
  {
    bank: 'isracard',
    homepageUrl: 'https://www.isracard.example/',
    postNavUrl: 'https://digital.isracard.example/personalarea/login',
    loginUrl: 'https://digital.isracard.example/personalarea/login',
    dashboardUrl: 'https://digital.isracard.example/personalarea',
    accountsUrl: 'https://digital.isracard.example/api/accounts',
    frameCount: 0,
    usesOtp: false,
    cookieCount: 0,
  },
  {
    bank: 'max',
    homepageUrl: 'https://www.max.example/',
    postNavUrl: 'https://www.max.example/login-page',
    loginUrl: 'https://www.max.example/login-page',
    dashboardUrl: 'https://www.max.example/account',
    accountsUrl: 'https://www.max.example/api/accounts',
    frameCount: 0,
    usesOtp: true,
    cookieCount: 3,
  },
  {
    bank: 'visacal',
    homepageUrl: 'https://www.cal-online.example/',
    postNavUrl: 'https://login.cal-online.example/Login',
    loginUrl: 'https://login.cal-online.example/Login',
    dashboardUrl: 'https://login.cal-online.example/MainPage',
    accountsUrl: 'https://login.cal-online.example/api/accounts',
    frameCount: 0,
    usesOtp: true,
    cookieCount: 3,
  },
];

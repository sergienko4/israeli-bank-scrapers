/**
 * Per-bank fixture expectations — STRUCTURAL invariants the captured
 * HTML must satisfy + Mode-B intercept origin. Drives the offline
 * integration tests.
 *
 * <p>Schema is OPEN by design: tests iterate over `steps[]`, banks
 * declare what they need. Adding new banks = new entry, no test code
 * change.
 *
 * <p>`requiresHydration: true` means the captured static HTML alone
 * isn't sufficient to drive LOGIN PRE discovery (SPA — the form is
 * rendered post-JS). Tests for these banks run STRUCTURAL checks
 * only, skipping the production-pipeline drive until asset capture
 * is implemented (follow-up PR).
 */

import type { IBankFixtureExpectations } from './FixtureExpectations.js';

const ISRACARD_PHASE_11_STEPS = [
  { stepName: '01-home' },
  {
    stepName: '02-pre-login',
    requiredFormIds: ['otpLobbyFormSms'],
    requiredInputIds: ['otpLoginId_SMS'],
    revealText: 'או כניסה עם סיסמה קבועה',
  },
  {
    stepName: '03-after-flip',
    requiredFormIds: ['otpLobbyFormSms', 'otpLobbyFormPassword'],
    requiredInputIds: ['otpLoginId_ID', 'otpLoginPwd'],
  },
  { stepName: '04-login-action' },
  { stepName: '07-auth-discovery' },
  { stepName: '08-account-resolve' },
  { stepName: '09-dashboard' },
  { stepName: '10-scrape-cycle-billing' },
  { stepName: '11-balance' },
] as const;

const AMEX_PHASE_11_STEPS = [
  { stepName: '01-home' },
  {
    stepName: '02-pre-login',
    requiredFormIds: ['otpLobbyFormSms'],
    requiredInputIds: ['otpLoginId_SMS'],
    revealText: 'או כניסה עם סיסמה קבועה',
  },
  {
    stepName: '03-after-flip',
    requiredFormIds: ['otpLobbyFormSms', 'otpLobbyFormPassword'],
    requiredInputIds: ['otpLoginId_ID', 'otpLoginPwd'],
  },
  { stepName: '04-login-action' },
  { stepName: '07-auth-discovery' },
  { stepName: '08-account-resolve' },
  { stepName: '09-dashboard' },
  { stepName: '10-scrape-transactions' },
  { stepName: '11-balance' },
] as const;

const VISACAL_PHASE_11_STEPS = [
  { stepName: '01-home' },
  { stepName: '02-pre-login' },
  { stepName: '03-after-username' },
  { stepName: '04-password-entered' },
  { stepName: '07-auth-discovery' },
  { stepName: '08-account-resolve' },
  { stepName: '09-dashboard' },
  { stepName: '10-scrape-transactions' },
  { stepName: '11-balance' },
] as const;

const BANK_FIXTURE_EXPECTATIONS: readonly IBankFixtureExpectations[] = [
  {
    bankId: 'isracard',
    originUrl: 'https://digital.isracard.co.il',
    loginStep: '03-after-flip',
    loginFormId: 'otpLobbyFormPassword',
    requiresHydration: false,
    steps: ISRACARD_PHASE_11_STEPS,
  },
  {
    bankId: 'amex',
    originUrl: 'https://he.americanexpress.co.il',
    loginStep: '03-after-flip',
    loginFormId: 'otpLobbyFormPassword',
    requiresHydration: false,
    steps: AMEX_PHASE_11_STEPS,
  },
  {
    bankId: 'beinleumi',
    originUrl: 'https://www.fibi.co.il',
    loginStep: '03-after-prelogin',
    // Beinleumi renders the credential form inside an Angular-driven
    // iframe post-JS — captured static HTML contains only the search
    // input + sandboxed iframe shell. Drive test is skipped; structural
    // assertions still gate the lobby shell + reveal-text invariants.
    requiresHydration: true,
    steps: [
      { stepName: '01-home' },
      { stepName: '02-modal-opened', revealText: 'כניסה עם סיסמה' },
      {
        stepName: '03-after-prelogin',
        requiredInputIds: [],
        requiredFormIds: [],
      },
    ],
  },
  {
    bankId: 'hapoalim',
    originUrl: 'https://login.bankhapoalim.co.il',
    loginStep: '02-pre-login',
    requiresHydration: false,
    steps: [
      { stepName: '01-home' },
      { stepName: '02-pre-login' },
      { stepName: '04-login-action' },
      { stepName: '07-auth-discovery' },
      { stepName: '08-account-resolve' },
      { stepName: '09-dashboard' },
    ],
  },
  {
    bankId: 'discount',
    originUrl: 'https://start.telebank.co.il',
    loginStep: '02-pre-login',
    requiresHydration: false,
    steps: [{ stepName: '01-home' }, { stepName: '02-pre-login' }],
  },
  {
    bankId: 'max',
    originUrl: 'https://www.max.co.il',
    loginStep: '04-reveal-password',
    requiresHydration: false,
    steps: [
      { stepName: '01-home' },
      { stepName: '02-after-entry' },
      { stepName: '03-after-private' },
      { stepName: '04-reveal-password' },
      { stepName: '07-auth-discovery' },
      { stepName: '08-account-resolve' },
      { stepName: '09-dashboard' },
      { stepName: '10-scrape-transactions' },
      { stepName: '11-balance' },
    ],
  },
  {
    bankId: 'visaCal',
    originUrl: 'https://www.cal-online.co.il',
    loginStep: '02-pre-login',
    requiresHydration: true,
    steps: VISACAL_PHASE_11_STEPS,
  },
  {
    bankId: 'mercantile',
    originUrl: 'https://start.telebank.co.il',
    loginStep: '02-pre-login',
    requiresHydration: false,
    steps: [{ stepName: '01-home' }, { stepName: '02-pre-login' }],
  },
  {
    bankId: 'massad',
    originUrl: 'https://online.bankmassad.co.il',
    loginStep: '02-pre-login',
    requiresHydration: true,
    steps: [{ stepName: '01-home' }, { stepName: '02-pre-login' }],
  },
  {
    bankId: 'pagi',
    originUrl: 'https://onlinepagi.bankpoalim.co.il',
    loginStep: '02-pre-login',
    requiresHydration: true,
    steps: [{ stepName: '01-home' }, { stepName: '02-pre-login' }],
  },
  {
    bankId: 'otsarHahayal',
    originUrl: 'https://digital.otsarh.co.il',
    loginStep: '02-pre-login',
    requiresHydration: true,
    steps: [{ stepName: '01-home' }, { stepName: '02-pre-login' }],
  },
];

export default BANK_FIXTURE_EXPECTATIONS;

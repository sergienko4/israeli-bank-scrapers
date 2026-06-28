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

/**
 * Beinleumi Phase-11 step inventory — distinct from MAX / AMEX /
 * Isracard / VisaCal / Hapoalim:
 * <ul>
 *   <li>`02-modal-opened` + `03-after-prelogin` are Beinleumi-distinct
 *       (real-captured Angular-iframe lobby, NOT the SMS / password
 *       flip shared by Isracard / AMEX).</li>
 *   <li>`05-otp-trigger` + `06-otp-fill` are the FIRST occurrence of
 *       explicit OTP phases in the Phase-11 series — Beinleumi is
 *       OTP-gated per `BeinleumiPipeline.ts`
 *       (`.withOtpTrigger().withOtpFill()`); Hapoalim's Mode B
 *       COLLAPSES OTP into a single LOGIN→AUTH_DISCOVERY transition;
 *       MAX / AMEX / Isracard / VisaCal / Discount are password-only
 *       (no OTP leg at all).</li>
 *   <li>`10-scrape-transactions` is named after Beinleumi's
 *       `bff-balancetransactions/api/v1/transactions/list` BFF
 *       endpoint, NOT MAX's `getTransactionsAndGraphs` or AMEX's
 *       `CardsTransactionsList`.</li>
 * </ul>
 * Beinleumi now uses the captured iframe content (`03-after-prelogin/
 * frame-2.html`, 51KB, with full `<input type="password">` + form
 * structure) served as the main document for cross-bank Mode B
 * discovery — so `requiresHydration: false` is correct. Mode A marker
 * checks + Mode B SIMULATOR state-machine still operate against the
 * same `BEINLEUMI_PHASE_11_STEPS` chain.
 */
const BEINLEUMI_PHASE_11_STEPS = [
  { stepName: '01-home' },
  { stepName: '02-modal-opened', revealText: 'כניסה עם סיסמה' },
  {
    stepName: '03-after-prelogin',
    requiredInputIds: [],
    requiredFormIds: [],
  },
  { stepName: '04-login-action' },
  { stepName: '05-otp-trigger' },
  { stepName: '06-otp-fill' },
  { stepName: '07-auth-discovery' },
  { stepName: '08-account-resolve' },
  { stepName: '09-dashboard' },
  { stepName: '10-scrape-transactions' },
  { stepName: '11-balance' },
] as const;

const LEUMI_PHASE_11_STEPS = [
  { stepName: '01-home' },
  { stepName: '04-login-action' },
  { stepName: '07-auth-discovery' },
  { stepName: '08-account-resolve' },
  { stepName: '09-dashboard' },
  { stepName: '10-scrape-transactions' },
  { stepName: '11-balance' },
] as const;

const BANK_FIXTURE_EXPECTATIONS: readonly IBankFixtureExpectations[] = [
  {
    bankId: 'leumi',
    originUrl: 'https://www.leumi.co.il',
    loginStep: '04-login-action',
    requiresHydration: false,
    steps: LEUMI_PHASE_11_STEPS,
  },
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
    // Point at the harvested top-document file (03-after-flip/main.html)
    // instead of the directory-style step name. The directory siblings
    // (frames.json + frame-0..8.html) describe analytics/recaptcha
    // iframes that DO NOT contain the credential form (it lives in the
    // top document under <form id="otpLobbyFormPassword">). Using the
    // `<dir>/main` path keeps MirrorInterceptor from loading
    // `<dir>/frames.json` for replay, so the resolver never wastes
    // discovery time probing third-party iframes (reCAPTCHA,
    // DoubleClick) — mirrors the visaCal/beinleumi pattern of pointing
    // loginStep at the file that actually holds the credential form.
    loginStep: '03-after-flip/main',
    loginFormId: 'otpLobbyFormPassword',
    requiresHydration: false,
    steps: AMEX_PHASE_11_STEPS,
  },
  {
    bankId: 'beinleumi',
    originUrl: 'https://www.fibi.co.il',
    loginStep: '03-after-prelogin/frame-2',
    // Beinleumi renders the credential form inside an Angular-driven
    // iframe (name="loginFrame"). The harvester captures the iframe
    // content as 03-after-prelogin/frame-2.html (51KB with full
    // <input type="password"> + form structure). Point loginStep at
    // the nested iframe HTML — MirrorInterceptor + FixturePage both
    // resolve `${stepName}.html` so the iframe content is served as
    // the main document at fibi.co.il for cross-bank discovery to
    // operate on.
    requiresHydration: false,
    steps: BEINLEUMI_PHASE_11_STEPS,
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
    // VisaCal moved to OTP-first UX; password login lives in the
    // alternative tab "כניסה עם שם משתמש" which renders the form
    // inside an iframe pointing at connect.cal-online.co.il/regular-login.
    // The harvester captures that iframe content as
    // 03-username-tab/frame-9.html (66KB with full <input type="password">
    // + <input formcontrolname="userName">). Point loginStep at the
    // nested iframe HTML so MirrorInterceptor + FixturePage serve the
    // hydrated credential form as the main document at www.cal-online.co.il
    // for cross-bank discovery to operate on (mirrors the Beinleumi
    // 03-after-prelogin/frame-2 pattern).
    loginStep: '03-username-tab/frame-9',
    requiresHydration: false,
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

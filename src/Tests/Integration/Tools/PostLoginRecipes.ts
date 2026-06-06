/**
 * Per-bank POST-LOGIN harvest recipes.
 *
 * <p>Defines the per-phase capture sequence the harvester runs after
 * the LOGIN ACTION succeeds. Steps use the discriminated union from
 * {@link RecipeStepTypes} so the same executor handles pre-login and
 * post-login uniformly.
 *
 * <p>Step naming convention matches the PHASE_CHAIN positions so
 * fixture folders mirror the pipeline diagram:
 * <ul>
 *   <li>`05-otp-trigger` / `06-otp-fill` — OTP banks only.</li>
 *   <li>`07-auth-discovery` — first stable post-login DOM.</li>
 *   <li>`08-account-resolve` — account selector + API responses.</li>
 *   <li>`09-dashboard` — landed dashboard with balance.</li>
 *   <li>`10-scrape` — first transaction page + matrix loop probe.</li>
 *   <li>`11-balance-resolve` — final balance read.</li>
 * </ul>
 *
 * <p>SPA banks (Beinleumi, VisaCal) use `snapshot` with
 * `waitForLifecycle: 'networkidle'` so the hydrated post-JS DOM is
 * captured — no JS bundle commit required.
 *
 * <p>Recipes here are CONSUMED by the harvester only. Production
 * code never imports this module.
 */

import { none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import type { IExtendedRecipe } from './RecipeStepTypes.js';

/** Generic dashboard wait — captures hydrated DOM regardless of bank UX. */
const DASHBOARD_NETWORKIDLE_TIMEOUT_MS = 30000;

/** Isracard: card-only flow. PRE-LOGIN already captured by legacy recipe. */
const ISRACARD_POST_LOGIN: IExtendedRecipe = {
  bankId: 'isracard',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: 'NewAccountTransactions',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-current-billing',
      urlPattern: '/CurrentBillingDate',
      captureAs: 'CurrentBillingDate',
      methods: ['POST'],
    },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: '/Transactions',
      captureAs: 'Transactions',
      methods: ['POST'],
    },
  ],
};

/** Amex: same pipeline as Isracard but distinct URLs. */
const AMEX_POST_LOGIN: IExtendedRecipe = {
  bankId: 'amex',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: 'NewAccountTransactions',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-current-billing',
      urlPattern: '/CurrentBillingDate',
      captureAs: 'CurrentBillingDate',
      methods: ['POST'],
    },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: '/Transactions',
      captureAs: 'Transactions',
      methods: ['POST'],
    },
  ],
};

/** Discount: legacy banking app, no OTP, has account-resolve picker. */
const DISCOUNT_POST_LOGIN: IExtendedRecipe = {
  bankId: 'discount',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: '/portalserver/',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '08-account-resolve', waitForLifecycle: 'networkidle' },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: '/lastTransactions',
      captureAs: 'lastTransactions',
    },
    {
      kind: 'recordResponse',
      stepName: '11-balance',
      urlPattern: '/currentAccount',
      captureAs: 'currentAccount',
    },
  ],
};

/** Max: SPA-ish credit card site. */
const MAX_POST_LOGIN: IExtendedRecipe = {
  bankId: 'max',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: 'main/homepage',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: '/transactions-search',
      captureAs: 'transactions-search',
      methods: ['POST'],
    },
  ],
};

/** VisaCal: pure SPA — hydrated DOM snapshot is the deliverable. */
const VISACAL_POST_LOGIN: IExtendedRecipe = {
  bankId: 'visaCal',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: 'cal4u',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: '/CalCardsTransactions',
      captureAs: 'CalCardsTransactions',
      methods: ['POST'],
    },
  ],
};

/**
 * Hapoalim post-login recipe with DUAL scrape capture.
 *
 * <p>Captures BOTH endpoints intentionally so PR-B2 has a baseline:
 * <ul>
 *   <li><code>/movements/preview</code> — the buggy endpoint the
 *       current pipeline calls; returns only the preview rows, NOT
 *       the full cycle bill (#hapoalim-preview-bug).</li>
 *   <li><code>/cycle-billing</code> — the correct endpoint the user
 *       expects the pipeline to call. This is what PR-B2's fix will
 *       switch to (rooted in
 *       <code>UrlDateRange.ts</code> /
 *       <code>MatrixLoopStrategy.ts</code> /
 *       <code>AccountScrapeStrategy.ts</code>).</li>
 * </ul>
 *
 * <p>Mode B mirror tests in PR-A2.3 will lock the bug as RED until
 * PR-B2 lands the fix, then flip GREEN automatically. Do NOT remove
 * either capture without first auditing PR-B2's mirror assertions.
 */
const HAPOALIM_POST_LOGIN: IExtendedRecipe = {
  bankId: 'hapoalim',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: '/general/accounts',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '08-account-resolve', waitForLifecycle: 'networkidle' },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-preview',
      urlPattern: '/movements/preview',
      captureAs: 'movements-preview',
    },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-cycle-billing',
      urlPattern: '/cycle-billing',
      captureAs: 'cycle-billing',
    },
    {
      kind: 'recordResponse',
      stepName: '11-balance',
      urlPattern: '/balance',
      captureAs: 'balance',
    },
  ],
};

/** Beinleumi: OTP bank + Angular SPA shell. */
const BEINLEUMI_POST_LOGIN: IExtendedRecipe = {
  bankId: 'beinleumi',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    { kind: 'snapshot', stepName: '05-otp-trigger', waitForLifecycle: 'networkidle' },
    { kind: 'snapshot', stepName: '06-otp-fill', waitForLifecycle: 'networkidle' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      textVisible: 'תנועות בחשבון',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '09-dashboard', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: '/AccountTransactions',
      captureAs: 'AccountTransactions',
    },
  ],
};

/** Registry: bankId → post-login recipe. */
const POST_LOGIN_RECIPES: Readonly<Partial<Record<string, IExtendedRecipe>>> = {
  isracard: ISRACARD_POST_LOGIN,
  amex: AMEX_POST_LOGIN,
  discount: DISCOUNT_POST_LOGIN,
  max: MAX_POST_LOGIN,
  visaCal: VISACAL_POST_LOGIN,
  hapoalim: HAPOALIM_POST_LOGIN,
  beinleumi: BEINLEUMI_POST_LOGIN,
};

/**
 * List bankIds with a registered post-login recipe.
 * @returns Sorted bankIds (snapshot).
 */
function knownPostLoginBanks(): readonly string[] {
  return Object.keys(POST_LOGIN_RECIPES).sort();
}

/**
 * Lookup the post-login recipe for a bank.
 *
 * @param bankId - Canonical bank identifier matching the {@link POST_LOGIN_RECIPES} key.
 * @returns Some(recipe) when registered, otherwise none.
 */
function getPostLoginRecipe(bankId: string): Option<IExtendedRecipe> {
  const recipe = POST_LOGIN_RECIPES[bankId];
  if (recipe === undefined) return none();
  return some(recipe);
}

export { getPostLoginRecipe, knownPostLoginBanks, POST_LOGIN_RECIPES };

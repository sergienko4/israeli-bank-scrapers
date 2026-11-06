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
 * <p>SPA banks (e.g. Leumi) use `snapshot` with
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

/** Discount: legacy banking app, no OTP, has account-resolve picker. */
const DISCOUNT_POST_LOGIN = {
  bankId: 'discount',
  steps: [
    { kind: 'login', stepName: '04-login-action' },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: 'MY_ACCOUNT_HOMEPAGE',
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
} as const satisfies IExtendedRecipe;

/** Leumi: no OTP; SPA shell at eBanking/SO/SPA.aspx. The DASHBOARD tail is
 *  a two-step menu nav — עובר ושב (current account) then תנועות בחשבון
 *  (account movements) — which fires the UC_SO_27 GetBusinessAccountTrx
 *  Broker.svc call carrying the transactions. Reveal steps click those
 *  menus by visible text; recordResponse flushes the UC_SO_27 envelope. */
const LEUMI_POST_LOGIN = {
  bankId: 'leumi',
  steps: [
    { kind: 'login', stepName: '04-login-action', snapshot: false },
    {
      kind: 'waitFor',
      stepName: '07-auth-discovery',
      urlIncludes: 'SPA.aspx',
      timeoutMs: DASHBOARD_NETWORKIDLE_TIMEOUT_MS,
    },
    { kind: 'snapshot', stepName: '08-account-resolve', waitForLifecycle: 'networkidle' },
    { kind: 'reveal', stepName: '09-dashboard', revealText: 'עובר ושב' },
    { kind: 'reveal', stepName: '10-reveal-transactions', revealText: 'תנועות בחשבון' },
    { kind: 'snapshot', stepName: '11-balance', waitForLifecycle: 'networkidle' },
    {
      kind: 'recordResponse',
      stepName: '10-scrape-transactions',
      urlPattern: 'UC_SO_27',
      captureAs: 'business-account-trx',
    },
  ],
} as const satisfies IExtendedRecipe;

/**
 * Registry: bankId → post-login recipe.
 *
 * <p>Kept as `Readonly<Partial<Record<string, IExtendedRecipe>>>` rather
 * than `as const` per PR-321 cycle-1 finding #15 (partial deferral): the
 * registry is indexed dynamically in {@link getPostLoginRecipe}; per-recipe
 * constants above already carry `as const satisfies IExtendedRecipe`.
 */
const POST_LOGIN_RECIPES: Readonly<Partial<Record<string, IExtendedRecipe>>> = {
  discount: DISCOUNT_POST_LOGIN,
  leumi: LEUMI_POST_LOGIN,
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

/** Discrete pre-login recipe step — one URL navigation OR one REVEAL click. */
interface IRecipeStep {
  readonly stepName: string;
  /** Absolute URL to navigate to (only set on steps that change URL). */
  readonly url?: string;
  /** Visible text of an element to click after navigation (REVEAL action). */
  readonly revealText?: string;
  /**
   * Wait for a credential `<input type="password">` to render before
   * snapshotting. SPA banks (e.g. an Angular shell) may snapshot
   * before bootstrap completes — flipping this true makes the
   * harvester block until the credential form is in the DOM.
   *
   * <p>Consumes the structural-selector exception in CLAUDE.md
   * (frame detection via `input[type="password"]`). Has NO effect at
   * runtime in production scrapers — harvester-only wiring.
   */
  readonly waitForCredentialInput?: true;
}

/** Pre-login capture recipe (steps only). bankId derived from map key. */
interface IRecipeBody {
  readonly steps: readonly IRecipeStep[];
}

/** Fully-resolved pre-login recipe used by the harvester driver. */
interface IBankRecipe {
  readonly bankId: string;
  readonly steps: readonly IRecipeStep[];
}

/**
 * Per-bank pre-login recipes — the map key IS the bankId.
 * Adding a new bank means adding a key + steps; no duplicate bankId field.
 *
 * <p>NOTE: Kept as `Readonly<Partial<Record<string, IRecipeBody>>>` rather
 * than `as const` per PR-321 cycle-1 finding #14 — consumers in
 * {@link ../../Integration/Tools/HarvestBankHtml.ts} index this map with
 * dynamic `bankId: string` values; literal-narrowed types would force
 * `as` casts at every consumer site. Per-step recipe constants below
 * (and post-login recipes above) DO use `as const satisfies` since they
 * are referenced by name, not dynamically indexed.
 */
const BANK_RECIPES: Readonly<Partial<Record<string, IRecipeBody>>> = {
  discount: {
    steps: [
      { stepName: '01-home', url: 'https://www.discountbank.co.il' },
      { stepName: '02-pre-login', url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE' },
    ],
  },
  mercantile: {
    steps: [
      { stepName: '01-home', url: 'https://www.mercantile.co.il' },
      { stepName: '02-pre-login', url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE' },
    ],
  },
  pagi: {
    steps: [
      { stepName: '01-home', url: 'https://www.pagi.co.il' },
      { stepName: '02-pre-login', url: 'https://online.pagi.co.il' },
    ],
  },
  otsarHahayal: {
    steps: [
      { stepName: '01-home', url: 'https://www.bankotsar.co.il' },
      { stepName: '02-pre-login', url: 'https://online.bankotsar.co.il' },
    ],
  },
  leumi: {
    steps: [
      { stepName: '01-home', url: 'https://www.leumi.co.il/' },
      {
        stepName: '04-login-action',
        url: 'https://hb2.bankleumi.co.il/H/Login.html',
        waitForCredentialInput: true,
      },
    ],
  },
};

/**
 * Build the resolved pre-login recipe — bundles map key with the
 * steps body, removing the duplicate-bankId smell.
 * @param bankId - The map key (canonical bankId).
 * @param body - The recipe body from {@link BANK_RECIPES}.
 * @returns Fully resolved {@link IBankRecipe}.
 */
function toRecipe(bankId: string, body: IRecipeBody): IBankRecipe {
  return { bankId, steps: body.steps };
}

export {
  BANK_RECIPES,
  getPostLoginRecipe,
  type IBankRecipe,
  type IRecipeBody,
  type IRecipeStep,
  knownPostLoginBanks,
  POST_LOGIN_RECIPES,
  toRecipe,
};

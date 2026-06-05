/**
 * Mode A integration test — drives production LOGIN PRE discovery against
 * captured PRE-LOGIN HTML fixtures. Zero network, no credentials, no real
 * bank traffic. Catches cross-bank regressions in
 * {@link executeDiscoverFields} that real-bank E2E (slow + flaky + creds-
 * gated) would otherwise hide.
 *
 * <p>For each bank in {@link BANK_FIXTURE_EXPECTATIONS}:
 * <ul>
 *   <li>STRUCTURAL: every captured step has the declared form ids + input
 *       ids present in the DOM (cheap, catches harvest drift).</li>
 *   <li>DRIVE (banks with `requiresHydration:false` AND a known LOGIN
 *       config): boot a real Camoufox page, load `loginStep` HTML, create
 *       a real {@link createElementMediator}, call
 *       {@link executeDiscoverFields}, and assert every resolved field's
 *       `closest('form')` matches {@link IBankFixtureExpectations.loginFormId}.
 *       This invariant is what the #307 Isracard regression violates.</li>
 * </ul>
 */

import * as fsSync from 'node:fs';

import type { Browser, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { createElementMediator } from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { executeDiscoverFields } from '../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.js';
import {
  loadBankFixturePaths,
  loadStep,
  newFixturePage,
  resolveFixtureRoot,
} from '../Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from '../Helpers/IntegrationBrowserFixture.js';
import {
  assertAllFieldsResolved,
  buildResolvedMap,
  closeQuietly,
  makeSilentLogger,
} from '../Helpers/IntegrationDriveAssertions.js';
import BANK_FIXTURE_EXPECTATIONS from './BankFixtureExpectations.js';
import BANK_LOGIN_CONFIGS from './BankLoginConfigs.js';
import type { IBankFixtureExpectations, IStepExpectations } from './FixtureExpectations.js';

const BROWSER_BOOT_TIMEOUT_MS = 120000;
const DRIVE_TIMEOUT_MS = 120000;

/**
 * Check whether a bank's fixture directory exists on disk.
 * Banks whose fixtures haven't been harvested yet are skipped so the
 * test surface declares "expected coverage" while harvest is in progress.
 * @param bankId - Bank recipe id.
 * @returns true when the fixture root exists.
 */
function fixtureRootExistsSync(bankId: string): boolean {
  const root = resolveFixtureRoot(bankId);
  return fsSync.existsSync(root);
}

/**
 * CSS-escape an attribute value: backslashes first, then double quotes.
 * Order matters — escaping `"` before `\\` would double-escape the
 * inserted backslashes. Closes the CodeQL "Incomplete string escaping"
 * finding for the `tag[id="..."]` selector builder.
 * @param value - Raw attribute value.
 * @returns Value safe to embed inside `"..."` in a CSS attribute selector.
 */
function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Assert every declared element id is present in the page DOM using a
 * safe attribute selector (`tag[id="..."]`) so ids containing CSS
 * special characters (`.`, `:`, `[`, `\`, `"`) are matched correctly.
 * Counts run concurrently — a single missing id fails the whole batch.
 * @param page - Playwright page with the step HTML loaded.
 * @param ids - Element ids the fixture must contain.
 * @param tagName - Tag name to anchor the attribute match (e.g. `form`, `input`).
 */
async function assertIdsPresent(
  page: Page,
  ids: readonly string[],
  tagName: string,
): Promise<void> {
  const probes = ids.map((id): Promise<{ id: string; count: number }> => {
    const selector = `${tagName}[id="${escapeCssAttrValue(id)}"]`;
    const loc = page.locator(selector);
    return loc.count().then((count): { id: string; count: number } => ({ id, count }));
  });
  const results = await Promise.all(probes);
  for (const result of results) {
    if (result.count === 0) throw new ScraperError(`fixture missing ${tagName}[id="${result.id}"]`);
    expect(result.count).toBeGreaterThan(0);
  }
}

/**
 * Run all structural assertions for one step.
 * @param page - Playwright page with the step HTML loaded.
 * @param step - Step expectations.
 */
async function assertStepStructure(page: Page, step: IStepExpectations): Promise<void> {
  await assertIdsPresent(page, step.requiredFormIds ?? [], 'form');
  await assertIdsPresent(page, step.requiredInputIds ?? [], 'input');
}

/**
 * Read the `closest('form')#id` of the first element matching a selector.
 * @param page - Playwright page.
 * @param selector - Resolved field selector (CSS or xpath-prefixed).
 * @returns Form id or `''` when not inside any form.
 */
async function closestFormId(page: Page, selector: string): Promise<string> {
  const loc = page.locator(selector).first();
  return loc.evaluate((el: Element): string => el.closest('form')?.id ?? '');
}

/**
 * Bundle for {@link runDriveOnce} — under the 3-param ceiling.
 */
interface IDriveArgs {
  readonly browser: Browser;
  readonly bank: IBankFixtureExpectations;
  readonly config: ILoginConfig;
}

/**
 * Run production discovery against the loaded page.
 * @param page - Playwright page with the step HTML loaded.
 * @param cfg - Bank LOGIN config to drive against.
 * @returns Discovery result.
 */
async function runDiscoveryOnPage(
  page: Page,
  cfg: ILoginConfig,
): Promise<Awaited<ReturnType<typeof executeDiscoverFields>>> {
  const mediator = createElementMediator(page);
  return executeDiscoverFields({
    mediator,
    config: cfg,
    activeFrame: page,
    page,
    logger: makeSilentLogger(),
  });
}

/**
 * Load the step HTML and run discovery in one shot.
 * @param page - Pre-created Playwright page.
 * @param args - Drive arguments (bank + config).
 * @returns Resolved selectors + form anchor selector.
 */
async function loadAndDiscover(
  page: Page,
  args: IDriveArgs,
): Promise<{ resolved: ReadonlyMap<string, string>; anchorSelector: string }> {
  const paths = await loadBankFixturePaths(args.bank.bankId);
  await loadStep(page, paths, args.bank.loginStep);
  const result = await runDiscoveryOnPage(page, args.config);
  const resolved = buildResolvedMap(result);
  const anchorSelector = result.formAnchor.has ? result.formAnchor.value.selector : '';
  return { resolved, anchorSelector };
}

/**
 * Drive {@link executeDiscoverFields} once on a fresh page and return the
 * resolved selectors keyed by credentialKey + the discovered form anchor.
 * Closes the page's context on any error so browser resources never leak.
 * @param args - Drive arguments.
 * @returns Page + resolved selectors + form-anchor selector.
 */
async function runDriveOnce(args: IDriveArgs): Promise<{
  readonly page: Page;
  readonly resolved: ReadonlyMap<string, string>;
  readonly anchorSelector: string;
}> {
  const page = await newFixturePage(args.browser);
  try {
    const { resolved, anchorSelector } = await loadAndDiscover(page, args);
    return { page, resolved, anchorSelector };
  } catch (err) {
    await closeQuietly(page);
    throw err;
  }
}

/** Bundle passed to {@link assertFieldsInsideFormAnchor}. */
interface IFieldAnchorAssertArgs {
  readonly page: Page;
  readonly resolved: ReadonlyMap<string, string>;
  readonly cfg: ILoginConfig;
  readonly expectedFormId: string;
}

/** Bundle passed to {@link probeOneFieldAnchor}. */
interface IFieldAnchorProbeArgs {
  readonly page: Page;
  readonly sel: string;
  readonly key: string;
  readonly expectedFormId: string;
}

/**
 * Probe one field's closest-form id and throw with diagnostics on mismatch.
 * @param args - Page + selector + credential key + expected form id.
 * @returns The matched form id (same as `expectedFormId` on success).
 */
async function probeOneFieldAnchor(args: IFieldAnchorProbeArgs): Promise<string> {
  const formId = await closestFormId(args.page, args.sel);
  if (formId !== args.expectedFormId) {
    throw new ScraperError(
      `field ${args.key} (sel=${args.sel}) lives in form#${formId}, ` +
        `expected form#${args.expectedFormId}`,
    );
  }
  expect(formId).toBe(args.expectedFormId);
  return formId;
}

/**
 * Build a probe per credential field whose selector resolved. Fields
 * with no resolved selector are skipped.
 * @param args - Page + resolved selectors + config + expected anchor id.
 * @returns Promises probing each field's form id.
 */
function buildAnchorProbes(args: IFieldAnchorAssertArgs): Promise<string>[] {
  const probes: Promise<string>[] = [];
  for (const field of args.cfg.fields) {
    const sel = args.resolved.get(field.credentialKey);
    if (sel === undefined) continue;
    const probeArgs: IFieldAnchorProbeArgs = {
      page: args.page,
      sel,
      key: field.credentialKey,
      expectedFormId: args.expectedFormId,
    };
    const probe = probeOneFieldAnchor(probeArgs);
    probes.push(probe);
  }
  return probes;
}

/**
 * Assert every resolved selector's closest `<form>` matches the expected
 * anchor id. Form lookups run concurrently per credential field.
 * @param args - Page + resolved selectors + config + expected anchor id.
 * @returns Number of fields whose anchor was verified.
 */
async function assertFieldsInsideFormAnchor(args: IFieldAnchorAssertArgs): Promise<number> {
  const probes = buildAnchorProbes(args);
  const matched = await Promise.all(probes);
  return matched.length;
}

describe('LoginFieldDiscovery cross-bank integration (Mode A — static HTML)', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  });

  describe.each(BANK_FIXTURE_EXPECTATIONS)('$bankId', (bank: IBankFixtureExpectations) => {
    const hasFixtures = fixtureRootExistsSync(bank.bankId);
    const itOrSkipStep = hasFixtures ? it : it.skip;

    describe.each(bank.steps)('step $stepName', (step: IStepExpectations) => {
      itOrSkipStep('fixture HTML matches declared structural invariants', async () => {
        const browser = await getIntegrationBrowser();
        const page = await newFixturePage(browser);
        try {
          const paths = await loadBankFixturePaths(bank.bankId);
          await loadStep(page, paths, step.stepName);
          await assertStepStructure(page, step);
        } finally {
          await page.context().close();
        }
      });
    });

    const cfg = BANK_LOGIN_CONFIGS[bank.bankId];
    const canDrive = !bank.requiresHydration && hasFixtures && cfg !== undefined;
    const maybeIt = canDrive ? it : it.skip;

    maybeIt(
      'LOGIN PRE discovers form anchor and every field lives INSIDE it',
      async () => {
        if (cfg === undefined) throw new ScraperError(`no LOGIN config for ${bank.bankId}`);
        const browser = await getIntegrationBrowser();
        const drive = await runDriveOnce({ browser, bank, config: cfg });
        try {
          if (drive.anchorSelector === '') throw new ScraperError('form anchor not discovered');
          expect(drive.anchorSelector).not.toBe('');
          assertAllFieldsResolved(cfg, drive.resolved);
          if (bank.loginFormId !== undefined) {
            await assertFieldsInsideFormAnchor({
              page: drive.page,
              resolved: drive.resolved,
              cfg,
              expectedFormId: bank.loginFormId,
            });
          }
        } finally {
          await closeQuietly(drive.page);
        }
      },
      DRIVE_TIMEOUT_MS,
    );
  });
});

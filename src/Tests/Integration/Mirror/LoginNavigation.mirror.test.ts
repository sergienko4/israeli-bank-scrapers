/**
 * Mode B integration test — drives production LOGIN PRE discovery against
 * a local mirror origin that replays captured HTML at the bank's REAL URL.
 *
 * <p>Difference from Mode A:
 * <ul>
 *   <li>Mode A uses `page.setContent(html)` — DOM is present but the
 *       URL is `about:blank`; navigation chain is bypassed.</li>
 *   <li>Mode B uses `page.goto(originUrl)` against {@link installMirror}
 *       — the production navigation code path runs end-to-end without
 *       touching the live bank.</li>
 * </ul>
 *
 * <p>Both modes drive the SAME production resolver code
 * ({@link executeDiscoverFields}) against the SAME captured HTML, but
 * Mode B additionally exercises the URL resolution + page navigation
 * code paths Mode A skips. Together they form the HARD GATE before the
 * Phase-5 real-bank e2e run.
 *
 * <p>Banks listed in `.github/banks-pending-reharvest.txt` skip the
 * drive test (recipe-gap tracked separately).
 */

import * as fsSync from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { createElementMediator } from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { executeDiscoverFields } from '../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.js';
import BANK_FIXTURE_EXPECTATIONS from '../Banks/BankFixtureExpectations.js';
import BANK_LOGIN_CONFIGS from '../Banks/BankLoginConfigs.js';
import type { IBankFixtureExpectations } from '../Banks/FixtureExpectations.js';
import { newFixturePage, resolveFixtureRoot } from '../Helpers/FixturePage.js';
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
import { installMirror } from '../Helpers/MirrorInterceptor.js';

const BROWSER_BOOT_TIMEOUT_MS = 120000;
const DRIVE_TIMEOUT_MS = 240000;
const MIRROR_GOTO_TIMEOUT_MS = 30000;
const HERE_URL = import.meta.url;
const HERE_PATH = fileURLToPath(HERE_URL);
const HERE = dirname(HERE_PATH);
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const PENDING_REHARVEST_FILE = join(REPO_ROOT, '.github', 'banks-pending-reharvest.txt');

/**
 * Read the pending-reharvest allow-list once. Listed banks skip Mode B
 * drive with a pointer to the file so the operator knows which recipe
 * gap they're tracking.
 * @returns Set of bankIds whose harvest recipe is being updated.
 */
function loadPendingReharvest(): ReadonlySet<string> {
  if (!fsSync.existsSync(PENDING_REHARVEST_FILE)) return new Set();
  const content = fsSync.readFileSync(PENDING_REHARVEST_FILE, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries = lines.map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'));
  return new Set(entries);
}

const PENDING_REHARVEST = loadPendingReharvest();

/**
 * Check whether a bank's fixture directory exists on disk.
 * @param bankId - Bank recipe id.
 * @returns True when the fixture root exists.
 */
function fixtureRootExistsSync(bankId: string): boolean {
  const root = resolveFixtureRoot(bankId);
  return fsSync.existsSync(root);
}

/** Bundle for {@link runMirrorDrive} — under the 3-param ceiling. */
interface IDriveArgs {
  readonly browser: Browser;
  readonly bank: IBankFixtureExpectations;
  readonly config: ILoginConfig;
}

/**
 * Install the mirror on the page using the bank's identifying triplet.
 * @param page - Playwright page to attach the mirror to.
 * @param bank - Bank fixture row (provides bankId, loginStep, originUrl).
 * @returns Promise that resolves once the mirror is installed.
 */
async function installMirrorOnPage(page: Page, bank: IBankFixtureExpectations): Promise<void> {
  await installMirror({
    page,
    bankId: bank.bankId,
    stepName: bank.loginStep,
    originUrl: bank.originUrl,
  });
}

/**
 * Navigate the page to the bank origin (intercepted by the mirror).
 * @param page - Page with mirror already installed.
 * @param originUrl - The bank's real URL to navigate to.
 * @returns Promise resolving once domcontentloaded fires.
 */
async function navigateToOrigin(page: Page, originUrl: string): Promise<void> {
  await page.goto(originUrl, {
    waitUntil: 'domcontentloaded',
    timeout: MIRROR_GOTO_TIMEOUT_MS,
  });
}

/**
 * Install mirror + navigate, closing the page on any failure so the
 * Playwright context never leaks when setup throws.
 * @param page - Fresh fixture page.
 * @param args - Drive arguments (bank + originUrl).
 * @returns True after install+navigate completes.
 */
async function installAndNavigate(page: Page, args: IDriveArgs): Promise<true> {
  try {
    await installMirrorOnPage(page, args.bank);
    await navigateToOrigin(page, args.bank.originUrl);
    return true;
  } catch (err) {
    await closeQuietly(page);
    throw err;
  }
}

/**
 * Boot a fresh page, install the mirror, and navigate to the bank's
 * real URL (intercepted by the mirror). On any setup failure the page
 * is torn down so the Playwright context never leaks.
 * @param args - Drive arguments.
 * @returns The prepared page.
 */
async function setupMirrorPage(args: IDriveArgs): Promise<Page> {
  const page = await newFixturePage(args.browser);
  await installAndNavigate(page, args);
  return page;
}

/**
 * Package the discovery result into the resolved-selectors + anchor-selector
 * pair consumed by drive helpers.
 * @param result - Discovery result from {@link executeDiscoverFields}.
 * @returns Resolved map + anchor selector.
 */
function packageDiscoveryResult(result: Awaited<ReturnType<typeof executeDiscoverFields>>): {
  resolved: ReadonlyMap<string, string>;
  anchorSelector: string;
} {
  const resolved = buildResolvedMap(result);
  const anchorSelector = result.formAnchor.has ? result.formAnchor.value.selector : '';
  return { resolved, anchorSelector };
}

/**
 * Drive production LOGIN PRE discovery against the page and return
 * the resolved selectors + the discovered form-anchor selector.
 * @param page - Page after mirror install + navigation.
 * @param cfg - Bank LOGIN config.
 * @returns Resolved map + anchor selector.
 */
async function discoverAndResolveTargets(
  page: Page,
  cfg: ILoginConfig,
): Promise<{ resolved: ReadonlyMap<string, string>; anchorSelector: string }> {
  const mediator = createElementMediator(page);
  const result = await executeDiscoverFields({
    mediator,
    config: cfg,
    activeFrame: page,
    page,
    logger: makeSilentLogger(),
  });
  return packageDiscoveryResult(result);
}

/**
 * Spin up a page with the mirror installed, navigate to the bank's real
 * origin (intercepted by the mirror), then drive LOGIN PRE discovery.
 * Closes the page on any error so browser resources never leak.
 * @param args - Drive arguments.
 * @returns Page + resolved selectors + discovered form-anchor selector.
 */
async function runMirrorDrive(args: IDriveArgs): Promise<{
  readonly page: Page;
  readonly resolved: ReadonlyMap<string, string>;
  readonly anchorSelector: string;
}> {
  const page = await setupMirrorPage(args);
  try {
    const { resolved, anchorSelector } = await discoverAndResolveTargets(page, args.config);
    return { page, resolved, anchorSelector };
  } catch (err) {
    await closeQuietly(page);
    throw err;
  }
}

/** Args bundle for {@link assertFieldsContainedInAnchor} — keeps params ≤3. */
interface IContainmentArgs {
  readonly page: Page;
  readonly resolved: ReadonlyMap<string, string>;
  readonly anchorSelector: string;
}

/**
 * Probe one resolved field and check whether it is contained inside
 * the discovered anchor DOM node (uses `Node.contains` browser-side).
 * @param page - Playwright page.
 * @param selector - Resolved field selector.
 * @param anchorSelector - The discovered form-anchor selector.
 * @returns True when the field is inside the anchor.
 */
async function probeFieldInsideAnchor(
  page: Page,
  selector: string,
  anchorSelector: string,
): Promise<boolean> {
  const fieldLoc = page.locator(selector).first();
  const anchorLoc = page.locator(anchorSelector).first();
  const anchorHandle = await anchorLoc.elementHandle();
  if (anchorHandle === null) return false;
  const isInside = await fieldLoc.evaluate(
    (el: Element, anchor: Element): boolean => anchor.contains(el),
    anchorHandle,
  );
  await anchorHandle.dispose();
  return isInside;
}

/**
 * Build a containment probe for one resolved field. The probe throws
 * if the field's DOM node is outside the discovered anchor.
 * @param page - Playwright page.
 * @param anchorSelector - The discovered form-anchor selector.
 * @param entry - Tuple of [credentialKey, resolvedSelector] from the map.
 * @returns Promise resolving to `true` when the field is inside the anchor.
 */
function buildOneContainmentProbe(
  page: Page,
  anchorSelector: string,
  entry: readonly [string, string],
): Promise<boolean> {
  const [key, selector] = entry;
  return probeFieldInsideAnchor(page, selector, anchorSelector).then((inside): boolean => {
    if (!inside) throw new ScraperError(`field ${key} resolved OUTSIDE anchor`);
    return inside;
  });
}

/**
 * Build a containment probe per resolved field. Each probe runs
 * concurrently in {@link assertFieldsContainedInAnchor}.
 * @param args - Page + resolved selectors + anchor selector.
 * @returns Promises probing each field's containment.
 */
function buildContainmentProbes(args: IContainmentArgs): Promise<boolean>[] {
  const probes: Promise<boolean>[] = [];
  for (const entry of args.resolved.entries()) {
    const probe = buildOneContainmentProbe(args.page, args.anchorSelector, entry);
    probes.push(probe);
  }
  return probes;
}

/**
 * Assert every resolved field is contained inside the discovered form
 * anchor element — same invariant Mode A asserts via `closest('form')`
 * but using `Node.contains()` so it works for non-`<form>` anchors too
 * (some banks anchor on `<div>` wrappers when the live form is absent).
 * @param args - Page + resolved selectors + anchor selector.
 * @returns Number of fields verified.
 */
async function assertFieldsContainedInAnchor(args: IContainmentArgs): Promise<number> {
  const probes = buildContainmentProbes(args);
  const results = await Promise.all(probes);
  return results.length;
}

describe('LoginNavigation cross-bank integration (Mode B — mirror origin)', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  });

  describe.each(BANK_FIXTURE_EXPECTATIONS)('$bankId', (bank: IBankFixtureExpectations) => {
    const hasFixtures = fixtureRootExistsSync(bank.bankId);
    const isPending = PENDING_REHARVEST.has(bank.bankId);
    const cfgForBank = BANK_LOGIN_CONFIGS[bank.bankId];
    const canDrive =
      !bank.requiresHydration && hasFixtures && !isPending && cfgForBank !== undefined;
    const maybeIt = canDrive ? it : it.skip;

    maybeIt(
      'mirror replays loginStep HTML at real origin and DRIVE resolves every field INSIDE anchor',
      async () => {
        if (cfgForBank === undefined) {
          throw new ScraperError(`no LOGIN config for ${bank.bankId}`);
        }
        const browser = await getIntegrationBrowser();
        const drive = await runMirrorDrive({ browser, bank, config: cfgForBank });
        try {
          if (drive.anchorSelector === '') throw new ScraperError('form anchor not discovered');
          expect(drive.anchorSelector).not.toBe('');
          assertAllFieldsResolved(cfgForBank, drive.resolved);
          await assertFieldsContainedInAnchor({
            page: drive.page,
            resolved: drive.resolved,
            anchorSelector: drive.anchorSelector,
          });
        } finally {
          await closeQuietly(drive.page);
        }
      },
      DRIVE_TIMEOUT_MS,
    );
  });
});

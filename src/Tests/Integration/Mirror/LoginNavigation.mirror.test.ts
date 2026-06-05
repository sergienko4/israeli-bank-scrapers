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

import pino from 'pino';
import type { Browser, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { createElementMediator } from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { executeDiscoverFields } from '../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.js';
import type { ScraperLogger } from '../../../Scrapers/Pipeline/Types/Debug.js';
import BANK_FIXTURE_EXPECTATIONS from '../Banks/BankFixtureExpectations.js';
import BANK_LOGIN_CONFIGS from '../Banks/BankLoginConfigs.js';
import type { IBankFixtureExpectations } from '../Banks/FixtureExpectations.js';
import { newFixturePage, resolveFixtureRoot } from '../Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from '../Helpers/IntegrationBrowserFixture.js';
import { installMirror } from '../Helpers/MirrorInterceptor.js';

const BROWSER_BOOT_TIMEOUT_MS = 120000;
const DRIVE_TIMEOUT_MS = 120000;
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

/**
 * Silent logger satisfying the ScraperLogger contract.
 * @returns A pino instance with logging disabled.
 */
function makeSilentLogger(): ScraperLogger {
  return pino({ enabled: false });
}

/** Bundle for {@link runMirrorDrive} — under the 3-param ceiling. */
interface IDriveArgs {
  readonly browser: Browser;
  readonly bank: IBankFixtureExpectations;
  readonly config: ILoginConfig;
}

/**
 * Close the page's context, swallowing teardown races so the cleanup
 * path never masks the original error from the caller.
 * @param page - Playwright page to clean up.
 * @returns True after teardown.
 */
async function closeQuietly(page: Page): Promise<true> {
  try {
    await page.context().close();
  } catch {
    // swallow: context may already be closing from a parallel afterAll
  }
  return true;
}

/**
 * Build the result map keyed by credentialKey from the discovery output.
 * @param result - Discovery result containing target selectors.
 * @returns Read-only map of credentialKey → resolved selector.
 */
function buildResolvedMap(
  result: Awaited<ReturnType<typeof executeDiscoverFields>>,
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  for (const [key, target] of result.targets.entries()) {
    resolved.set(key, target.selector);
  }
  return resolved;
}

/**
 * Boot a fresh page, install the mirror, and navigate to the bank's
 * real URL (intercepted by the mirror).
 * @param args - Drive arguments.
 * @returns The prepared page.
 */
async function setupMirrorPage(args: IDriveArgs): Promise<Page> {
  const page = await newFixturePage(args.browser);
  await installMirror({
    page,
    bankId: args.bank.bankId,
    stepName: args.bank.loginStep,
    originUrl: args.bank.originUrl,
  });
  await page.goto(args.bank.originUrl, {
    waitUntil: 'domcontentloaded',
    timeout: MIRROR_GOTO_TIMEOUT_MS,
  });
  return page;
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
  const resolved = buildResolvedMap(result);
  const anchorSelector = result.formAnchor.has ? result.formAnchor.value.selector : '';
  return { resolved, anchorSelector };
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

/**
 * Assert every credential field from the config was resolved by drive.
 * Pure map-presence check — does NOT touch the page.
 * @param cfg - Bank LOGIN config.
 * @param resolved - Resolved selectors by credentialKey.
 * @returns Number of fields verified.
 */
function assertAllFieldsResolved(cfg: ILoginConfig, resolved: ReadonlyMap<string, string>): number {
  for (const field of cfg.fields) {
    if (!resolved.has(field.credentialKey)) {
      throw new ScraperError(`field ${field.credentialKey} not resolved by mirror drive`);
    }
    const wasResolved = resolved.has(field.credentialKey);
    expect(wasResolved).toBe(true);
  }
  return cfg.fields.length;
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
 * Assert every resolved field is contained inside the discovered form
 * anchor element — same invariant Mode A asserts via `closest('form')`
 * but using `Node.contains()` so it works for non-`<form>` anchors too
 * (some banks anchor on `<div>` wrappers when the live form is absent).
 * @param args - Page + resolved selectors + anchor selector.
 * @returns Number of fields verified.
 */
async function assertFieldsContainedInAnchor(args: IContainmentArgs): Promise<number> {
  const probes: Promise<boolean>[] = [];
  for (const [key, selector] of args.resolved.entries()) {
    const probe = probeFieldInsideAnchor(args.page, selector, args.anchorSelector).then(
      (inside): boolean => {
        if (!inside) throw new ScraperError(`field ${key} resolved OUTSIDE anchor`);
        return inside;
      },
    );
    probes.push(probe);
  }
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

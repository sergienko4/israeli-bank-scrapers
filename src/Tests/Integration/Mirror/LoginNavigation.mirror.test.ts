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
 * Spin up a page with the mirror installed, navigate to the bank's real
 * origin (intercepted by the mirror), then drive LOGIN PRE discovery.
 * @param args - Drive arguments.
 * @returns Page + resolved selectors + discovered form-anchor selector.
 */
async function runMirrorDrive(args: IDriveArgs): Promise<{
  readonly page: Page;
  readonly resolved: ReadonlyMap<string, string>;
  readonly anchorSelector: string;
}> {
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
  const mediator = createElementMediator(page);
  const result = await executeDiscoverFields({
    mediator,
    config: args.config,
    activeFrame: page,
    page,
    logger: makeSilentLogger(),
  });
  const resolved = new Map<string, string>();
  for (const [key, target] of result.targets.entries()) {
    resolved.set(key, target.selector);
  }
  const anchorSelector = result.formAnchor.has ? result.formAnchor.value.selector : '';
  return { page, resolved, anchorSelector };
}

/**
 * Assert every credential field from the config was resolved by drive.
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
    const canDrive = !bank.requiresHydration && hasFixtures && !isPending;
    const maybeIt = canDrive ? it : it.skip;

    maybeIt(
      'mirror replays loginStep HTML at real origin and DRIVE resolves every field',
      async () => {
        const browser = await getIntegrationBrowser();
        const cfg = BANK_LOGIN_CONFIGS[bank.bankId] as ILoginConfig | undefined;
        if (cfg === undefined) throw new ScraperError(`no LOGIN config for ${bank.bankId}`);
        const drive = await runMirrorDrive({ browser, bank, config: cfg });
        try {
          if (drive.anchorSelector === '') throw new ScraperError('form anchor not discovered');
          expect(drive.anchorSelector).not.toBe('');
          assertAllFieldsResolved(cfg, drive.resolved);
        } finally {
          await drive.page.context().close();
        }
      },
      DRIVE_TIMEOUT_MS,
    );
  });
});

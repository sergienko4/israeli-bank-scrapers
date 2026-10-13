/**
 * Unit tests for the launcher's browser-stack check.
 *
 * <p>The check compares the installed Camoufox build and playwright-core
 * minor with the tested pair generated from `browser-stack.json`. It logs one
 * warning per mismatched component, once per process, and never rejects: a
 * reader failure is logged at debug level with its message redacted and only
 * skips that component, as does a logger that throws. Expected values come
 * from the generated module, so no test copies a pinned version.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { jest } from '@jest/globals';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';

const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Supply the shared logger to the module under test.
   * @returns Shared logger mock.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Preserve the legacy logger factory surface.
   * @returns Shared logger mock.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const { createBrowserStackCheck: CREATE_CHECK, DEFAULT_STACK_READERS: DEFAULT_READERS } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.js');
const { TESTED_CAMOUFOX_TAG, TESTED_PLAYWRIGHT_MINOR } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackConfig.js');
const { INSTALL_DIR } = await import('@hieutran094/camoufox-js/dist/pkgman.js');

/** Installed Camoufox build that matches the tested tag. */
const TESTED_CAMOUFOX = TESTED_CAMOUFOX_TAG.slice(1);
/** A playwright-core release of the tested minor. */
const TESTED_PLAYWRIGHT = `${TESTED_PLAYWRIGHT_MINOR}.0`;
/** A Camoufox build no manifest pins. */
const OTHER_CAMOUFOX = '1.0.0-beta.1';
/** A playwright-core release of another minor. */
const OTHER_PLAYWRIGHT = '9.99.0';
/** Reader failure text; must never reach a log line. */
const SECRET_FAILURE = 'cannot read /home/someone/.cache/camoufox/version.json';

const CAMOUFOX_REMEDY =
  'Clear the Camoufox cache to refetch, or upgrade @sergienko4/israeli-bank-scrapers';
const PLAYWRIGHT_REMEDY = 'Install a playwright-core version matching the tested minor';
/** Any log message text. */
const ANY_MESSAGE: unknown = expect.any(String);
/** Repository root, where Jest runs. */
const CWD = process.cwd();

/** One reader outcome: a version, or the error it throws. */
type ReaderOutcome = string | Error;

/** Reader mocks the check consumes. */
interface ITestReaders {
  readonly camoufox: jest.Mock<Promise<string>, []>;
  readonly playwright: jest.Mock<Promise<string>, []>;
}

/**
 * Build a reader that resolves a version or rejects with an error.
 *
 * @param outcome - Version to resolve, or error to reject with.
 * @returns Reader mock.
 */
function makeReader(outcome: ReaderOutcome): jest.Mock<Promise<string>, []> {
  if (outcome instanceof Error) return jest.fn<Promise<string>, []>(() => Promise.reject(outcome));
  return jest.fn<Promise<string>, []>(() => Promise.resolve(outcome));
}

/**
 * Build both readers.
 *
 * @param camoufox - Camoufox outcome.
 * @param playwright - playwright-core outcome.
 * @returns Reader mocks.
 */
function makeReaders(camoufox: ReaderOutcome, playwright: ReaderOutcome): ITestReaders {
  const camoufoxReader = makeReader(camoufox);
  const playwrightReader = makeReader(playwright);
  return { camoufox: camoufoxReader, playwright: playwrightReader };
}

/**
 * Run one fresh check.
 *
 * @param readers - Readers to inject.
 * @returns The number of warnings it logged.
 */
async function runCheck(readers: ITestReaders): Promise<number> {
  const check = CREATE_CHECK(readers);
  return check();
}

/**
 * The Camoufox build camoufox-js has cached, read straight from its record.
 *
 * @returns `<version>-<release>`, or false when no build is cached.
 */
function cachedCamoufox(): string | false {
  const installDir = INSTALL_DIR.toString();
  const recordPath = join(installDir, 'version.json');
  try {
    const text = readFileSync(recordPath, 'utf8');
    const record = JSON.parse(text) as { version: string; release: string };
    return `${record.version}-${record.release}`;
  } catch {
    return false;
  }
}

/**
 * Settle a read to its version, or false when it rejects.
 *
 * @param reading - Pending read.
 * @returns The version, or false.
 */
function settleRead(reading: Promise<string>): Promise<string | false> {
  return reading.catch((): false => false);
}

/**
 * A logger call that fails, as a broken log sink would.
 *
 * @returns Never; it throws.
 */
function failLogging(): never {
  throw new ScraperError('log sink unavailable');
}

describe('checkBrowserStack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('[BSC-1] logs nothing when both components are the tested pair', async () => {
    const readers = makeReaders(TESTED_CAMOUFOX, TESTED_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(0);
    expect(LOG.warn).not.toHaveBeenCalled();
    expect(LOG.debug).not.toHaveBeenCalled();
  });

  it('[BSC-2] warns once with the version-only payload for another Camoufox', async () => {
    const readers = makeReaders(OTHER_CAMOUFOX, TESTED_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(1);
    expect(LOG.warn).toHaveBeenCalledTimes(1);
    const payload = {
      component: 'camoufox',
      installed: OTHER_CAMOUFOX,
      tested: TESTED_CAMOUFOX,
      remedy: CAMOUFOX_REMEDY,
    };
    expect(LOG.warn).toHaveBeenCalledWith(payload, ANY_MESSAGE);
  });

  it('[BSC-3] warns once with the version-only payload for another playwright-core minor', async () => {
    const readers = makeReaders(TESTED_CAMOUFOX, OTHER_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(1);
    expect(LOG.warn).toHaveBeenCalledTimes(1);
    const payload = {
      component: 'playwright-core',
      installed: OTHER_PLAYWRIGHT,
      tested: TESTED_PLAYWRIGHT_MINOR,
      remedy: PLAYWRIGHT_REMEDY,
    };
    expect(LOG.warn).toHaveBeenCalledWith(payload, ANY_MESSAGE);
  });

  it('[BSC-4] ignores a playwright-core patch release of the tested minor', async () => {
    const readers = makeReaders(TESTED_CAMOUFOX, `${TESTED_PLAYWRIGHT_MINOR}.7`);
    const count = await runCheck(readers);
    expect(count).toBe(0);
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('[BSC-5] warns for each mismatched component', async () => {
    const readers = makeReaders(OTHER_CAMOUFOX, OTHER_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(2);
    expect(LOG.warn).toHaveBeenCalledTimes(2);
  });

  it('[BSC-6] skips a failed reader with a redacted debug line and still checks the other', async () => {
    const failure = new ScraperError(SECRET_FAILURE);
    const readers = makeReaders(failure, OTHER_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(1);
    const debugLine = { component: 'camoufox', error: `<msg:${String(SECRET_FAILURE.length)}>` };
    expect(LOG.debug).toHaveBeenCalledWith(debugLine);
    const logged = JSON.stringify([LOG.debug.mock.calls, LOG.warn.mock.calls]);
    expect(logged).not.toContain('someone');
  });

  it('[BSC-7] resolves 0 without rejecting when a reader throws synchronously', async () => {
    const readers = makeReaders(TESTED_CAMOUFOX, TESTED_PLAYWRIGHT);
    readers.playwright.mockImplementation(() => {
      throw new ScraperError(SECRET_FAILURE);
    });
    const count = await runCheck(readers);
    expect(count).toBe(0);
    expect(LOG.debug).toHaveBeenCalledTimes(1);
  });

  it('[BSC-8] reads and warns on the first call only', async () => {
    const readers = makeReaders(OTHER_CAMOUFOX, OTHER_PLAYWRIGHT);
    const check = CREATE_CHECK(readers);
    const first = await check();
    const second = await check();
    expect([first, second]).toEqual([2, 0]);
    expect(readers.camoufox).toHaveBeenCalledTimes(1);
    expect(readers.playwright).toHaveBeenCalledTimes(1);
    expect(LOG.warn).toHaveBeenCalledTimes(2);
  });

  it('[BSC-9] default playwright reader returns the resolved playwright-core version', async () => {
    const manifestPath = join(CWD, 'node_modules/playwright-core/package.json');
    const text = readFileSync(manifestPath, 'utf8');
    const expected = (JSON.parse(text) as { version: string }).version;
    const installed = await DEFAULT_READERS.playwright();
    expect(installed).toBe(expected);
  });

  it('[BSC-10] default Camoufox reader returns the cached build, or rejects without one', async () => {
    const expected = cachedCamoufox();
    const reading = DEFAULT_READERS.camoufox();
    const installed = await settleRead(reading);
    expect(installed).toBe(expected);
  });

  it('[BSC-11] skips only the component whose warning throws, and still resolves', async () => {
    LOG.warn.mockImplementationOnce(failLogging);
    const readers = makeReaders(OTHER_CAMOUFOX, OTHER_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(1);
    expect(LOG.warn).toHaveBeenCalledTimes(2);
  });

  it('[BSC-12] skips a failed reader whose debug line throws, and still checks the other', async () => {
    LOG.debug.mockImplementationOnce(failLogging);
    const failure = new ScraperError(SECRET_FAILURE);
    const readers = makeReaders(failure, OTHER_PLAYWRIGHT);
    const count = await runCheck(readers);
    expect(count).toBe(1);
    expect(LOG.debug).toHaveBeenCalledTimes(1);
    expect(LOG.warn).toHaveBeenCalledTimes(1);
  });
});

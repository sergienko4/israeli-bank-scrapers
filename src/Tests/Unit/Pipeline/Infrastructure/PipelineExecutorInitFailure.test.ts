/**
 * A synchronous failure while building the initial context can happen after
 * the run's logger has already opened `pipeline.log` (for example, a TLS
 * profile warning before an incomplete mTLS override throws). `runWithCleanup`
 * never starts in that case, so the executor must retire the run-owned logger
 * itself or the file lease and worker leak.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { getRootLogger } from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { readEnvironment } from '../../../../Scrapers/Pipeline/Types/Environment.js';
import { getLogFile } from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';
import { type IPinoStream, readPinoStream } from '../../../Helpers/PinoStream.js';
import { awaitCondition } from './LogDrain.js';

/** Platform temp root, read once. */
const TEMP_ROOT = os.tmpdir();

/** Isolated run root; removed after each case. */
const RUNS_ROOT = path.join(TEMP_ROOT, 'test-runs-executor-init-failure');

/** Folder the mocked factory opened before throwing. */
let openedFolder = '';

/** Stream behind the logger the mocked factory opened before throwing. */
let openedStream: IPinoStream | false = false;

/** Close deadline for the retired logger's worker. */
const CLOSE_DEADLINE_MS = 5_000;

jest.unstable_mockModule('../../../../Scrapers/Pipeline/Core/PipelineContextFactory.js', () => ({
  /**
   * Open the run's file logger, then fail the way a synchronous wiring error
   * does: the scope is open, but `runWithCleanup` is never reached.
   * @returns Never; always throws.
   */
  default: (): never => {
    const logFile = getLogFile();
    openedFolder = path.dirname(logFile);
    const logger = getRootLogger();
    openedStream = readPinoStream(logger);
    throw new ScraperError('init failed after opening the run logger');
  },
}));

const { default: EXECUTE_PIPELINE } =
  await import('../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js');

/** Minimal options for the mocked context factory. */
const OPTIONS = {
  companyId: CompanyTypes.OneZero,
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

describe('PipelineExecutor — synchronous init failure cleanup', () => {
  afterEach(() => {
    fs.rmSync(RUNS_ROOT, { recursive: true, force: true });
    openedFolder = '';
    openedStream = false;
  });

  it('retires the run logger when context construction fails', async () => {
    const env = readEnvironment({ FORENSIC_TRACE: 'true', RUNS_ROOT });
    const descriptor = { options: OPTIONS, phases: [] };
    const credentials = { username: 'user', password: 'pass' };
    const result = await EXECUTE_PIPELINE(descriptor, credentials, env);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
    });
    expect(result.errorMessage).toContain('init failed after opening the run logger');
    expect(openedFolder).not.toBe('');
    expect(openedStream).not.toBe(false);
    if (openedStream === false) throw new ScraperError('mock did not open the run logger');
    const stream = openedStream;
    const didClose = await awaitCondition(
      (): boolean => stream.closed === true,
      Date.now() + CLOSE_DEADLINE_MS,
    );
    expect(didClose).toBe(true);
  });
});

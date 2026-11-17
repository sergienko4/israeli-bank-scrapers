/**
 * `pipeline.log` opens in append mode with a `0600` creation mode, but the
 * mode argument applies only when the file is created. A pre-existing file
 * must be tightened to owner-only as well, so an old permissive log cannot
 * keep exposing forensic content.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import pino from 'pino';

import { instantiateLeasedFileLogger } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import retireSupersededLogger from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
import { buildSilentOptions } from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { buildFdOptions } from '../../../../Scrapers/Pipeline/Logging/RootLoggerOptions.js';

/**
 * Build file-backed Pino options for one descriptor.
 * @param fd - Open descriptor.
 * @returns Pino options.
 */
function fileOptions(fd: number): pino.LoggerOptions {
  return buildFdOptions(fd, false);
}

/**
 * Report a transport failure without emitting noise.
 * @returns Always true.
 */
function onFailure(): true {
  return true;
}

/**
 * Build the silent fallback logger.
 * @returns Silent Pino logger.
 */
function silentLogger(): pino.Logger {
  const options = buildSilentOptions();
  return pino(options);
}

const isWindows = process.platform === 'win32';

describe('forensic log file mode', () => {
  it('tightens a pre-existing permissive log file to 0600', () => {
    if (!isWindows) {
      const tempRoot = os.tmpdir();
      const prefixPath = path.join(tempRoot, 'log-mode-');
      const dir = fs.mkdtempSync(prefixPath);
      const logFile = path.join(dir, 'pipeline.log');
      fs.writeFileSync(logFile, '', { mode: 0o644 });
      fs.chmodSync(logFile, 0o644);
      const built = instantiateLeasedFileLogger({
        logFile,
        buildPreferredOptions: fileOptions,
        buildFallbackOptions: fileOptions,
        onTransportFailure: onFailure,
        buildSilentFallback: silentLogger,
      });
      const mode = fs.statSync(logFile).mode & 0o777;
      expect(mode).toBe(0o600);
      retireSupersededLogger(built.logger, built.lease);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

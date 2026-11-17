/**
 * Pretty logging is opt-in, and never fatal.
 *
 * <p>Transport selection used to be keyed on `CI` and `NODE_ENV`:
 *
 * <pre>const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';</pre>
 *
 * <p>The name asserted something the expression could not know. It does not
 * mean "this library is being developed"; it means "the caller set neither
 * variable", which is the ordinary state of any application depending on
 * it. Every such consumer was handed a `pino-pretty` transport — a
 * devDependency, absent from their production install — and the scrape died
 * resolving it before reaching the network (issue #552).
 *
 * <p>No CI job could see this. A GitHub runner always sets `CI=true`, so
 * the branch was unreachable, and devDependencies are always installed, so
 * the target always resolved. The check was tested only in the one
 * environment where it could not fail.
 *
 * <p>These specs pin the replacement contract: pretty output happens when
 * it is asked for, a trace file is honoured either way, and a transport
 * that cannot be built degrades the logger instead of ending the scrape.
 * Degradation is exercised through the public `getRootLogger` path: Pino's
 * bundler hook makes one configured target unresolvable, exactly as a missing
 * production dependency would.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';
import type pino from 'pino';

import { runWithBankContext } from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import {
  buildTransport,
  getRootLogger,
  retireRunLogger,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { readEnvironment } from '../../../../Scrapers/Pipeline/Types/Environment.js';
import { type IPinoStream, readPinoStream } from '../../../Helpers/PinoStream.js';
import { awaitCondition } from '../Infrastructure/LogDrain.js';

/** A resolved trace-file destination. */
const LOG_FILE = '/tmp/pipeline-pretty-opt-in.log';

/** No trace file configured — the off-trace default. */
const NO_LOG_FILE = '';

/** Target name that must not appear unless pretty output was requested. */
const PRETTY_TARGET = 'pino-pretty';

/** File target used once a trace file is present. */
const FILE_TARGET = 'pino/file';

/** Suffix that makes a bundled target resolve to a module nobody installed. */
const MISSING_SUFFIX = '-not-installed';

/** Wall-clock budget for a retired worker to close. */
const CLOSE_DEADLINE_MS = 5_000;

/** Platform temp directory, read once for the file-backed degradation specs. */
const TMP_ROOT = os.tmpdir();

/** Temporary runs root prefix for the file-backed degradation specs. */
const RUNS_ROOT_PREFIX = path.join(TMP_ROOT, 'pretty-degrade-');

/** A logger built through the run path plus the live stream behind it. */
interface IRunLogger {
  readonly logger: pino.Logger;
  readonly stream: IPinoStream;
}

/** Warnings captured while a spec runs, with the spy restore hook. */
interface IWarningCapture {
  readonly warnings: string[];
  readonly restore: () => true;
}

/** Process global Pino consults before resolving a transport target. */
interface IBundlerHost {
  __bundlerPathsOverrides?: Record<string, string>;
}

/**
 * Environment captured at call time, so each spec controls the flags.
 * @returns The current environment snapshot.
 */
function envNow(): ReturnType<typeof readEnvironment> {
  return readEnvironment(process.env);
}

/**
 * Choose a transport using the current flags.
 * @param logFile - Resolved log file path.
 * @returns The transport choice.
 */
function transportFor(logFile: string): ReturnType<typeof buildTransport> {
  const env = envNow();
  return buildTransport(logFile, env);
}

/**
 * Serialise a transport choice so a spec can assert on the targets it names
 * without destructuring pino's single-vs-multi union.
 *
 * @param logFile - Resolved log file path handed to the selector.
 * @returns JSON form of the chosen transport.
 */
function describeTransport(logFile: string): string {
  const transport = transportFor(logFile);
  return JSON.stringify(transport);
}

/**
 * Build the root logger inside a run scope, then retire that run's destination.
 * @param env - Environment variables for the execution.
 * @returns The built logger and its live Pino stream.
 */
function startRunLogger(env: NodeJS.ProcessEnv): IRunLogger {
  const snapshot = readEnvironment(env);
  /**
   * Resolve the root logger and remember its stream before retirement.
   * @returns The logger and stream.
   */
  const build = (): IRunLogger => {
    const logger = getRootLogger();
    const stream = readPinoStream(logger);
    retireRunLogger();
    return { logger, stream };
  };
  return runWithBankContext('pepper', build, snapshot);
}

/**
 * Point one transport target at a module that does not exist.
 * @param target - Bundled target to break.
 * @param run - Work that constructs the logger.
 * @returns Whatever `run` returns.
 */
function withMissingTarget<T>(target: string, run: () => T): T {
  const host = globalThis as IBundlerHost;
  const previous = host.__bundlerPathsOverrides;
  host.__bundlerPathsOverrides = { ...previous, [target]: `${target}${MISSING_SUFFIX}` };
  try {
    return run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(host, '__bundlerPathsOverrides');
    else host.__bundlerPathsOverrides = previous;
  }
}

/**
 * Record `process.emitWarning` calls instead of writing them to stderr.
 * @returns Recorded warnings plus the restore hook.
 */
function captureWarnings(): IWarningCapture {
  const warnings: string[] = [];
  /**
   * Record one emitted warning.
   * @param warning - Warning message or Error.
   * @returns Always true.
   */
  const record: typeof process.emitWarning = (warning): true => {
    const text = String(warning);
    warnings.push(text);
    return true;
  };
  const spy = jest.spyOn(process, 'emitWarning').mockImplementation(record);
  /**
   * Restore the real `process.emitWarning`.
   * @returns Always true.
   */
  const restore = (): true => {
    spy.mockRestore();
    return true;
  };
  return { warnings, restore };
}

/**
 * Create a private runs root for a file-backed degradation spec.
 * @returns Absolute directory path.
 */
function makeRunsRoot(): string {
  return fs.mkdtempSync(RUNS_ROOT_PREFIX);
}

/**
 * Wait for a retired file logger's worker to close.
 * @param stream - Live Pino stream read before retirement.
 * @returns True when the worker closed before the deadline.
 */
function awaitStreamClosed(stream: IPinoStream): Promise<boolean> {
  return awaitCondition((): boolean => stream.closed === true, Date.now() + CLOSE_DEADLINE_MS);
}

describe('pretty logs opt-in', () => {
  const originalFlag = process.env.PRETTY_LOGS;
  const originalCi = process.env.CI;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.PRETTY_LOGS;
    else process.env.PRETTY_LOGS = originalFlag;
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('[LOG-1] a consumer who asked for nothing gets no transport at all', () => {
    delete process.env.PRETTY_LOGS;
    const transport = transportFor(NO_LOG_FILE);
    expect(transport).toBe(false);
  });

  it('[LOG-2] a trace file alone never drags in the pretty target', () => {
    delete process.env.PRETTY_LOGS;
    const described = describeTransport(LOG_FILE);
    expect(described).not.toContain(PRETTY_TARGET);
  });

  it('[LOG-3] unsetting CI and NODE_ENV no longer implies pretty output', () => {
    delete process.env.PRETTY_LOGS;
    delete process.env.CI;
    process.env.NODE_ENV = 'development';
    const transport = transportFor(NO_LOG_FILE);
    expect(transport).toBe(false);
  });

  it('[LOG-4] asking for pretty output gets it', () => {
    process.env.PRETTY_LOGS = 'true';
    const described = describeTransport(NO_LOG_FILE);
    expect(described).toContain(PRETTY_TARGET);
  });

  it('[LOG-5] asking for pretty output with a trace file gets both', () => {
    process.env.PRETTY_LOGS = 'true';
    const described = describeTransport(LOG_FILE);
    expect(described).toContain(PRETTY_TARGET);
    expect(described).toContain(FILE_TARGET);
  });

  it('[LOG-6] the flag is default-deny, not truthy-anything', () => {
    process.env.PRETTY_LOGS = '1';
    const transport = transportFor(NO_LOG_FILE);
    expect(transport).toBe(false);
  });

  it('[LOG-7] a transport that cannot be built degrades instead of throwing', () => {
    const captured = captureWarnings();
    try {
      const { logger } = withMissingTarget(PRETTY_TARGET, () =>
        startRunLogger({ PRETTY_LOGS: 'true', LOG_LEVEL: 'debug' }),
      );
      expect(() => {
        logger.info('still usable');
      }).not.toThrow();
      expect(logger.level).toBe('silent');
      expect(captured.warnings).toHaveLength(1);
      expect(captured.warnings[0]).toContain('PRETTY_LOGS');
    } finally {
      captured.restore();
    }
  });

  it('[LOG-7b] keeps the supplied snapshot level when degrading', async () => {
    const dir = makeRunsRoot();
    const captured = captureWarnings();
    try {
      const { logger, stream } = withMissingTarget(PRETTY_TARGET, () =>
        startRunLogger({
          FORENSIC_TRACE: 'true',
          RUNS_ROOT: dir,
          PRETTY_LOGS: 'true',
          LOG_LEVEL: 'error',
        }),
      );
      expect(logger.level).toBe('error');
      const isClosed = await awaitStreamClosed(stream);
      expect(isClosed).toBe(true);
    } finally {
      captured.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The degradation warning is a diagnostic, so it has to name the real
   * cause. A trace-file transport can fail for reasons of its own — a
   * worker that will not start, a version mismatch — and blaming
   * `PRETTY_LOGS` for those sends whoever reads the warning after a flag
   * they never set.
   */
  it('[LOG-8] a failure with pretty output unrequested does not blame PRETTY_LOGS', () => {
    const dir = makeRunsRoot();
    const captured = captureWarnings();
    try {
      const { logger } = withMissingTarget(FILE_TARGET, () =>
        startRunLogger({ FORENSIC_TRACE: 'true', RUNS_ROOT: dir, LOG_LEVEL: 'info' }),
      );
      expect(logger.level).toBe('silent');
      expect(captured.warnings.length).toBeGreaterThan(0);
      expect(captured.warnings[0]).not.toContain('PRETTY_LOGS');
    } finally {
      captured.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * With a trace file configured the transport carries two targets, so a
   * failure is not attributable to either of them. Naming `PRETTY_LOGS`
   * then sends whoever reads the warning after a flag that may have had
   * nothing to do with it — the exact misdirection this warning exists to
   * prevent. The flag may only be blamed when pretty output was the only
   * target that could have failed.
   */
  it('[LOG-9] does not blame PRETTY_LOGS when pretty was not the only target', () => {
    const dir = makeRunsRoot();
    const captured = captureWarnings();
    try {
      withMissingTarget(FILE_TARGET, () =>
        startRunLogger({
          FORENSIC_TRACE: 'true',
          RUNS_ROOT: dir,
          PRETTY_LOGS: 'true',
          LOG_LEVEL: 'info',
        }),
      );
      expect(captured.warnings.length).toBeGreaterThan(0);
      expect(captured.warnings[0]).not.toContain('PRETTY_LOGS');
    } finally {
      captured.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The mirror of [LOG-9], and the reason this pair has to exist together.
   * Both other warning specs assert an absence, so `warnTransportFailure`
   * could collapse to the neutral prefix unconditionally and still satisfy
   * them — silently discarding the one attribution it can make with
   * certainty. Pretty output as the sole target is exactly that case.
   */
  it('[LOG-10] names PRETTY_LOGS when pretty output was the only target', () => {
    const captured = captureWarnings();
    try {
      withMissingTarget(PRETTY_TARGET, () =>
        startRunLogger({ PRETTY_LOGS: 'true', LOG_LEVEL: 'trace' }),
      );
      expect(captured.warnings).toHaveLength(1);
      expect(captured.warnings[0]).toContain('PRETTY_LOGS');
    } finally {
      captured.restore();
    }
  });
});

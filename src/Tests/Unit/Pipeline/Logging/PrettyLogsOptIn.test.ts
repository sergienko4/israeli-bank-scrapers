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
 */

import { jest } from '@jest/globals';

import {
  buildPinoOptions,
  buildTransport,
  instantiateLogger,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { readEnvironment } from '../../../../Scrapers/Pipeline/Types/Environment.js';

/** A resolved trace-file destination. */
const LOG_FILE = '/tmp/pipeline-pretty-opt-in.log';

/** No trace file configured — the off-trace default. */
const NO_LOG_FILE = '';

/** Target name that must not appear unless pretty output was requested. */
const PRETTY_TARGET = 'pino-pretty';

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
 * Build active pino options using the current flags.
 * @param target - Transport target.
 * @returns Pino logger options.
 */
function activeOptionsFor(
  target: Parameters<typeof buildPinoOptions>[0],
): ReturnType<typeof buildPinoOptions> {
  const env = envNow();
  return buildPinoOptions(target, env);
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
    expect(described).toContain('pino/file');
  });

  it('[LOG-6] the flag is default-deny, not truthy-anything', () => {
    process.env.PRETTY_LOGS = '1';
    const transport = transportFor(NO_LOG_FILE);
    expect(transport).toBe(false);
  });

  it('[LOG-7] a transport that cannot be built degrades instead of throwing', () => {
    const unresolvable = activeOptionsFor({ target: 'pino-pretty-not-installed' });
    const env = envNow();
    const logger = instantiateLogger(NO_LOG_FILE, unresolvable, env);
    expect(() => {
      logger.info('still usable');
    }).not.toThrow();
  });

  it('[LOG-7b] keeps the supplied snapshot level when degrading', () => {
    const unresolvable = activeOptionsFor({ target: 'pino-file-not-installed' });
    const env = readEnvironment({ LOG_LEVEL: 'error' });
    const logger = instantiateLogger(LOG_FILE, unresolvable, env);
    expect(logger.level).toBe('error');
  });

  /**
   * The degradation warning is a diagnostic, so it has to name the real
   * cause. A trace-file transport can fail for reasons of its own — a
   * worker that will not start, a version mismatch — and blaming
   * `PRETTY_LOGS` for those sends whoever reads the warning after a flag
   * they never set.
   */
  it('[LOG-8] a failure with pretty output unrequested does not blame PRETTY_LOGS', () => {
    delete process.env.PRETTY_LOGS;
    const warnings: string[] = [];
    const spy = jest.spyOn(process, 'emitWarning').mockImplementation(warning => {
      const text = String(warning);
      warnings.push(text);
    });
    const unresolvable = activeOptionsFor({ target: 'pino-file-not-installed' });
    const env = envNow();
    instantiateLogger(NO_LOG_FILE, unresolvable, env);
    spy.mockRestore();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('PRETTY_LOGS');
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
    process.env.PRETTY_LOGS = 'true';
    const warnings: string[] = [];
    const spy = jest.spyOn(process, 'emitWarning').mockImplementation(warning => {
      const text = String(warning);
      warnings.push(text);
    });
    const unresolvable = activeOptionsFor({ target: 'pino-file-not-installed' });
    const env = envNow();
    instantiateLogger(LOG_FILE, unresolvable, env);
    spy.mockRestore();
    expect(warnings[0]).not.toContain('PRETTY_LOGS');
  });

  /**
   * The mirror of [LOG-9], and the reason this pair has to exist together.
   * Both other warning specs assert an absence, so `warnTransportFailure`
   * could collapse to the neutral prefix unconditionally and still satisfy
   * them — silently discarding the one attribution it can make with
   * certainty. Pretty output as the sole target is exactly that case.
   */
  it('[LOG-10] names PRETTY_LOGS when pretty output was the only target', () => {
    process.env.PRETTY_LOGS = 'true';
    const warnings: string[] = [];
    const spy = jest.spyOn(process, 'emitWarning').mockImplementation(warning => {
      const text = String(warning);
      warnings.push(text);
    });
    const unresolvable = activeOptionsFor({ target: 'pino-pretty-not-installed' });
    const env = envNow();
    instantiateLogger(NO_LOG_FILE, unresolvable, env);
    spy.mockRestore();
    expect(warnings[0]).toContain('PRETTY_LOGS');
  });
});

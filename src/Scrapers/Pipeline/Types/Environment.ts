/**
 * The single production boundary for environment variables. Every other
 * Pipeline module reads the injected {@link IEnvironment} instead of touching
 * `process.env` directly, so a run has one place to audit and one object to
 * substitute in tests.
 *
 * <p>The process-wide {@link ENVIRONMENT} is read once at module load. A
 * `runWithBankContext` scope carries the environment it was opened with;
 * run-scoped readers use {@link activeEnvironment} so an injected execution
 * does not fall back to the process snapshot.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { IEnvironment } from './Domain/EnvironmentTypes.js';
import { currentRunScope } from './RunScope.js';

/** Platform temp directory, read once at module load. */
const TEMP_ROOT = os.tmpdir();

/** Default root for per-run artefact folders, overridable via `RUNS_ROOT`. */
const DEFAULT_RUNS_ROOT = path.join(TEMP_ROOT, 'israeli-bank-scrapers', 'runs');

/** Set once, so an operator who disables redaction sees one warning. */
let didWarnPiiRedaction = false;

/**
 * Read the execution-facing flags.
 * @param env - Process environment.
 * @returns Trace, log and run-root fields.
 */
function readExecutionEnvironment(
  env: NodeJS.ProcessEnv,
): Pick<IEnvironment, 'forensicTrace' | 'runsRoot' | 'prettyLogs' | 'logLevel'> {
  return {
    forensicTrace: (env.FORENSIC_TRACE ?? '').trim().toLowerCase() === 'true',
    runsRoot: env.RUNS_ROOT ?? DEFAULT_RUNS_ROOT,
    prettyLogs: (env.PRETTY_LOGS ?? '').trim().toLowerCase() === 'true',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

/**
 * Read the privacy flags.
 * @param env - Process environment.
 * @returns Window-backfill and PII-redaction flags.
 */
function readPrivacyEnvironment(
  env: NodeJS.ProcessEnv,
): Pick<IEnvironment, 'windowBackfillOff' | 'piiRedactionOff'> {
  return {
    windowBackfillOff: env.WINDOW_BACKFILL === 'off',
    piiRedactionOff: env.PII_REDACTION === 'off',
  };
}

/**
 * Read the mTLS override values.
 * @param env - Process environment.
 * @returns The OneZero certificate and key overrides.
 */
function readMtlsEnvironment(
  env: NodeJS.ProcessEnv,
): Pick<IEnvironment, 'oneZeroMtlsCert' | 'oneZeroMtlsKey'> {
  return {
    oneZeroMtlsCert: env.ONEZERO_MTLS_CERT ?? '',
    oneZeroMtlsKey: env.ONEZERO_MTLS_KEY ?? '',
  };
}

/**
 * Warn once when an operator disables business-data redaction.
 * @returns True after the first warning.
 */
function warnPiiRedactionOff(): true {
  if (!didWarnPiiRedaction) {
    didWarnPiiRedaction = true;
    process.emitWarning(
      'PII_REDACTION=off: masking is disabled; pipeline logs and captures may contain business data and credentials.',
    );
  }
  return true;
}

/**
 * Read the Pipeline environment once.
 * @param env - Process environment, injectable for tests.
 * @returns The frozen environment snapshot.
 */
function readEnvironment(env: NodeJS.ProcessEnv = process.env): IEnvironment {
  const snapshot = {
    ...readExecutionEnvironment(env),
    ...readPrivacyEnvironment(env),
    ...readMtlsEnvironment(env),
  };
  if (snapshot.piiRedactionOff) warnPiiRedactionOff();
  return Object.freeze(snapshot);
}

/** Process-wide snapshot used outside an execution (and as the default scope). */
const ENVIRONMENT = readEnvironment();

/**
 * The environment of the running execution, or the process-wide snapshot
 * outside one.
 * @returns The active environment.
 */
function activeEnvironment(): IEnvironment {
  const scope = currentRunScope();
  return scope ? scope.env : ENVIRONMENT;
}

export type { IEnvironment } from './Domain/EnvironmentTypes.js';
export { activeEnvironment, ENVIRONMENT, readEnvironment };

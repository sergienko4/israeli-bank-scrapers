/**
 * The environment values one Pipeline execution reads. Kept in a leaf module
 * so `Environment.ts` can read the active run scope and `RunScope.ts` can type
 * its carried environment without a runtime cycle.
 */

/** The environment values the Pipeline reads. */
interface IEnvironment {
  readonly forensicTrace: boolean;
  readonly runsRoot: string;
  readonly prettyLogs: boolean;
  readonly logLevel: string;
  readonly windowBackfillOff: boolean;
  readonly piiRedactionOff: boolean;
  readonly oneZeroMtlsCert: string;
  readonly oneZeroMtlsKey: string;
}

export type { IEnvironment };

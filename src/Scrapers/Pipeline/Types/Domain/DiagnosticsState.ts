import type { Option } from '../Option.js';

/** Diagnostics state — tracks timing and breadcrumbs. */
interface IDiagnosticsState {
  readonly loginUrl: string;
  readonly finalUrl: Option<string>;
  readonly loginStartMs: number;
  readonly fetchStartMs: Option<number>;
  readonly lastAction: string;
  readonly pageTitle: Option<string>;
  readonly warnings: readonly string[];
}

export type { IDiagnosticsState };

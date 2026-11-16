/**
 * Logger handle — the pino-shaped sink every pipeline consumer receives.
 *
 * <p>Defined in Types so context and phase contracts do not depend on the
 * Logging layer; Logging re-exports it for its public facade.
 */

import type { Logger } from 'pino';

/** Logger handle used by every pipeline consumer. */
type ScraperLogger = Logger;

export type { ScraperLogger };

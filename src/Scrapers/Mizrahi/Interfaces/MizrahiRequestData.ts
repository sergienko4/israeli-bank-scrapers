import type { JsonValue } from '../../Pipeline/Mediator/Network/Fetch/index.js';

/** Data payload for Mizrahi bank API requests. */
export interface IMizrahiRequestData {
  inFromDate: string;
  inToDate: string;
  table: { maxRow: number };
  [key: string]: JsonValue;
}

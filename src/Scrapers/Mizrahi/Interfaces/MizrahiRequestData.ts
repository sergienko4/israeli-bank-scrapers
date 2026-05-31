import type { JsonValue } from '../../../Common/Fetch.js';

/** Data payload for Mizrahi bank API requests. */
export interface IMizrahiRequestData {
  inFromDate: string;
  inToDate: string;
  table: { maxRow: number };
  [key: string]: JsonValue;
}

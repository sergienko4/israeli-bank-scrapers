export interface MizrahiRequestData {
  inFromDate: string;
  inToDate: string;
  table: { maxRow: number };
  [key: string]: unknown;
}

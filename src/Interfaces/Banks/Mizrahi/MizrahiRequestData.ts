export interface IMizrahiRequestData {
  inFromDate: string;
  inToDate: string;
  table: { maxRow: number };
  [key: string]: unknown;
}

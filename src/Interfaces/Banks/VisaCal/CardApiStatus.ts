export interface ICardApiStatus {
  title?: string; // API can omit this field on auth errors
  statusCode: number;
}

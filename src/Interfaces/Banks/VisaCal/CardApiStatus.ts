export interface CardApiStatus {
  title?: string; // API can omit this field on auth errors
  statusCode: number;
}

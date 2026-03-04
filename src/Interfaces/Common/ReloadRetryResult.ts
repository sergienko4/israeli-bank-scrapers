/** Result returned by waitUntilWithReload — no throw, caller decides what to do on failure. */
export interface ReloadRetryResult<T> {
  found: boolean;
  value: NonNullable<T> | null;
  reloadsUsed: number;
  description: string;
}

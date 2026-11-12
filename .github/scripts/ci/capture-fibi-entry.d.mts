export function captureFibiEntry(
  root: string,
  invoke?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Readonly<{ status: number; bytes: number; textLength: number }>>;

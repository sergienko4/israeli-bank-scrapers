export function assertNever(x: never, error = ''): never {
  throw new Error(error || `Unexpected object: ${String(x)}`);
}

export default assertNever;

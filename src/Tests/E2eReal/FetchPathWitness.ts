/** A path-only fetch recorder for real E2E protocol assertions. */
export interface IFetchPathWitness {
  readonly checkpoint: () => number;
  readonly pathsSince: (checkpoint: number) => readonly string[];
  readonly dispose: () => boolean;
}

type FetchInput = string | Request | URL;

/**
 * Resolves a fetch input without retaining request metadata.
 * @param input - Fetch input.
 * @returns Parsed request URL.
 */
function inputUrl(input: FetchInput): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

/**
 * Wraps fetch while retaining only URL pathnames.
 * @param original - Fetch implementation to forward to.
 * @param paths - Pathname sink.
 * @returns Transparent fetch wrapper.
 */
function witnessFetch(original: typeof fetch, paths: string[]): typeof fetch {
  return (input: FetchInput, init?: RequestInit): Promise<Response> => {
    paths.push(inputUrl(input).pathname);
    return original(input, init);
  };
}

/**
 * Restores fetch only when this witness still owns the wrapper.
 * @param original - Fetch implementation captured at installation.
 * @param wrapped - Wrapper installed by this witness.
 * @returns Whether restoration occurred.
 */
function restoreFetch(original: typeof fetch, wrapped: typeof fetch): boolean {
  if (globalThis.fetch !== wrapped) return false;
  globalThis.fetch = original;
  return true;
}

/**
 * Builds a checkpointed view over captured pathnames.
 * @param original - Fetch implementation captured at installation.
 * @param wrapped - Wrapper installed by this witness.
 * @param paths - Captured pathnames.
 * @returns Witness handle.
 */
function witnessHandle(
  original: typeof fetch,
  wrapped: typeof fetch,
  paths: string[],
): IFetchPathWitness {
  return {
    /**
     * Marks the current end of the captured path sequence.
     * @returns Current path count.
     */
    checkpoint: (): number => paths.length,
    /**
     * Reads paths captured from a checkpoint onward.
     * @param checkpoint - Previously captured path count.
     * @returns Paths captured at or after the checkpoint.
     */
    pathsSince: (checkpoint: number): readonly string[] => paths.slice(checkpoint),
    /**
     * Restores the wrapped fetch implementation.
     * @returns Whether this witness restored fetch.
     */
    dispose: (): boolean => restoreFetch(original, wrapped),
  };
}

/**
 * Installs a fetch witness that cannot retain query strings or request data.
 * @returns Checkpointed path recorder and restoration handle.
 */
export function installFetchPathWitness(): IFetchPathWitness {
  const original = globalThis.fetch;
  const paths: string[] = [];
  const wrapped = witnessFetch(original, paths);
  globalThis.fetch = wrapped;
  return witnessHandle(original, wrapped, paths);
}

/**
 * Replay many captured fixtures through one browser session.
 *
 * <p>Exists because the per-fixture cost of `T-LANDDOC` was not the
 * markup but the session: opening a browser context per file measured
 * ~1.5s, against ~12ms to parse the median fixture and ~30ms to run the
 * probe. Across the 298-file corpus that is roughly seven minutes of
 * pure setup per matrix leg, which starved the very `setContent` call
 * whose deadline then expired.
 *
 * <p>What is reused is the browser context, not the JavaScript realm.
 * `setContent` swaps the document but keeps the window, so a fixture's
 * globals, timers and observers otherwise outlive it and run against the
 * next fixture — measured on Leumi's corpus as a cross-fixture `var`
 * collision. Resetting the realm between fixtures is therefore the
 * caller's responsibility, and `T-LANDDOC` locks it with a case that
 * fails without it.
 *
 * <p>Narrowed to {@link IReplaySession} rather than a Playwright `Page`
 * so the reuse contract is assertable without a browser, and so the
 * suite can move to the element mediator by changing an adapter.
 */

/** Fixture paths, in replay order. */
type Paths = readonly string[];

/** One reusable replay surface: classify a fixture, then release it. */
interface IReplaySession {
  /**
   * Load a fixture and report the probe's verdict for it.
   * @param file - Fixture path to replay.
   * @returns True when the probe flags the fixture as an error document.
   */
  classify(file: string): Promise<boolean>;
  /**
   * Release the session's resources.
   * @returns Resolves once released.
   */
  close(): Promise<void>;
}

/** Opens a replay session on demand. */
type OpenReplaySession = () => Promise<IReplaySession>;

/**
 * Classify every fixture through one already-open session.
 *
 * <p>Sequential by construction. The `reduce` chain is the repo's
 * established way to order awaits without awaiting inside a loop, and
 * ordering matters: a concurrent replay would race fixtures into the
 * same document.
 *
 * @param session - Open session to replay through.
 * @param files - Fixture paths to classify.
 * @returns Fixture paths the probe flagged, in input order.
 */
async function collectFlagged(session: IReplaySession, files: Paths): Promise<Paths> {
  const seed: Promise<string[]> = Promise.resolve([]);
  return files.reduce(async (prev, file): Promise<string[]> => {
    const flagged = await prev;
    const isError = await session.classify(file);
    return isError ? [...flagged, file] : flagged;
  }, seed);
}

/**
 * Release a session without displacing a failure already in flight.
 *
 * <p>A bare `finally` would let a cleanup rejection replace the
 * fixture-naming error the caller needs, which is the diagnostic this
 * whole helper exists to provide.
 *
 * @param session - Session to release.
 * @returns Resolves once released, or once the release has failed.
 */
async function closeQuietly(session: IReplaySession): Promise<void> {
  try {
    await session.close();
  } catch {
    // The failure already travelling up names the offending fixture.
  }
}

/**
 * Classify every fixture, releasing the session if any of them throws.
 * @param session - Open session to replay through.
 * @param files - Fixture paths to classify.
 * @returns Fixture paths the probe flagged, in input order.
 */
async function replayThrough(session: IReplaySession, files: Paths): Promise<Paths> {
  try {
    return await collectFlagged(session, files);
  } catch (cause) {
    await closeQuietly(session);
    throw cause;
  }
}

/**
 * Replay a list of fixtures through a single session.
 *
 * <p>Opens nothing for an empty list: a session that is never used is
 * pure cost, and callers replay one bank at a time, so a bank with no
 * captures yields an empty slice. The session is closed on the failure
 * path too — a fixture that throws must not leak the context that was
 * replaying it.
 *
 * @param open - Opens the session to replay through.
 * @param files - Fixture paths to classify.
 * @returns Fixture paths the probe flagged, in input order.
 */
export default async function flaggedFixtures(
  open: OpenReplaySession,
  files: Paths,
): Promise<Paths> {
  if (files.length === 0) return [];
  const session = await open();
  const flagged = await replayThrough(session, files);
  await session.close();
  return flagged;
}

export type { IReplaySession, OpenReplaySession };

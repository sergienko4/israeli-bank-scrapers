/**
 * Fixture replay reuses one browser session across many fixtures.
 *
 * <p>The behaviour under test is a cost contract, not a rendering one:
 * `T-LANDDOC` replays 298 captured pages, and opening a browser context
 * per page measured ~1.5s each — 89% of that suite's runtime, and the
 * saturation that pushed a single `setContent` past its deadline on a
 * contended runner. Session reuse is therefore load-bearing, so it is
 * pinned here rather than left as an implementation detail.
 *
 * <p>Exercised through fakes on purpose. Reuse is countable without a
 * browser, and a browser-backed assertion would be slower and less
 * precise about the one thing that matters: how many sessions opened.
 */

import type { IReplaySession } from '../../Integration/Helpers/FixtureReplay.js';
import flaggedFixtures from '../../Integration/Helpers/FixtureReplay.js';

/** Observable counters a fake session records for assertions. */
interface IFakeState {
  opens: number;
  closes: number;
  seen: string[];
}

/** A fake session factory plus the counters it writes to. */
interface IFake {
  state: IFakeState;
  open: () => Promise<IReplaySession>;
}

/** Decides which fixture paths a fake classifies as error documents. */
type Flag = (file: string) => boolean;

/**
 * Build a `classify` that records the fixture before answering.
 * @param state - Counters to record into.
 * @param flag - Scripted verdict per fixture path.
 * @returns The recording `classify` half of a fake session.
 */
function recordClassify(state: IFakeState, flag: Flag): IReplaySession['classify'] {
  return (file: string): Promise<boolean> => {
    state.seen.push(file);
    const isFlagged = flag(file);
    return Promise.resolve(isFlagged);
  };
}

/**
 * Build a `close` that counts how often the session was closed.
 * @param state - Counters to record into.
 * @returns The recording `close` half of a fake session.
 */
function recordClose(state: IFakeState): IReplaySession['close'] {
  return (): Promise<void> => {
    state.closes += 1;
    return Promise.resolve();
  };
}

/**
 * Build a session factory that counts how often it was asked to open.
 * @param state - Counters to record into.
 * @param session - Session every call hands back.
 * @returns The counting factory.
 */
function countingOpen(state: IFakeState, session: IReplaySession): IFake['open'] {
  return (): Promise<IReplaySession> => {
    state.opens += 1;
    return Promise.resolve(session);
  };
}

/**
 * Build a fake session factory that records every interaction.
 * @param flag - Scripted verdict per fixture path.
 * @returns The factory and the counters it writes to.
 */
function makeFake(flag: Flag): IFake {
  const state: IFakeState = { opens: 0, closes: 0, seen: [] };
  const classify = recordClassify(state, flag);
  const session: IReplaySession = { classify, close: recordClose(state) };
  return { state, open: countingOpen(state, session) };
}

/**
 * Build a `classify` that rejects instead of answering.
 * @param boom - Failure every fixture rejects with.
 * @returns A classifier that never resolves successfully.
 */
function rejectClassify(boom: Error): IReplaySession['classify'] {
  return (): Promise<boolean> => Promise.reject(boom);
}

/**
 * Build a fake whose every fixture rejects, to prove cleanup still runs.
 * @param boom - Failure every fixture rejects with.
 * @returns The factory and the counters it writes to.
 */
function makeThrowingFake(boom: Error): IFake {
  const state: IFakeState = { opens: 0, closes: 0, seen: [] };
  const session: IReplaySession = { classify: rejectClassify(boom), close: recordClose(state) };
  return { state, open: countingOpen(state, session) };
}

/**
 * Build a `close` that rejects instead of releasing.
 * @param boom - Failure the release rejects with.
 * @returns A closer that never resolves successfully.
 */
function rejectClose(boom: Error): IReplaySession['close'] {
  return (): Promise<void> => Promise.reject(boom);
}

/**
 * Build a fake whose fixture and whose cleanup both fail.
 * @param onClassify - Failure the fixture rejects with.
 * @param onClose - Failure the release rejects with.
 * @returns The factory and the counters it writes to.
 */
function makeDoomedFake(onClassify: Error, onClose: Error): IFake {
  const state: IFakeState = { opens: 0, closes: 0, seen: [] };
  const classify = rejectClassify(onClassify);
  const session: IReplaySession = { classify, close: rejectClose(onClose) };
  return { state, open: countingOpen(state, session) };
}

/**
 * Verdict for a fake that flags nothing.
 * @returns Always false.
 */
const CLEAN: Flag = (): boolean => false;

const FILES = ['a.html', 'b.html', 'c.html'] as const;

describe('flaggedFixtures', () => {
  it('opens exactly one session however many fixtures it replays', async () => {
    const fake = makeFake(CLEAN);
    await flaggedFixtures(fake.open, FILES);
    expect(fake.state.opens).toBe(1);
  });

  it('classifies every fixture, in order', async () => {
    const fake = makeFake(CLEAN);
    await flaggedFixtures(fake.open, FILES);
    expect(fake.state.seen).toEqual(['a.html', 'b.html', 'c.html']);
  });

  it('returns only the fixtures the probe flagged', async () => {
    const fake = makeFake((file: string): boolean => file === 'b.html');
    const flagged = await flaggedFixtures(fake.open, FILES);
    expect(flagged).toEqual(['b.html']);
  });

  it('closes the session once when every fixture is clean', async () => {
    const fake = makeFake(CLEAN);
    await flaggedFixtures(fake.open, FILES);
    expect(fake.state.closes).toBe(1);
  });

  it('closes the session even when a fixture throws', async () => {
    const boom = new Error('setContent timed out');
    const fake = makeThrowingFake(boom);
    const pending = flaggedFixtures(fake.open, FILES);
    await expect(pending).rejects.toThrow('setContent timed out');
    expect(fake.state.closes).toBe(1);
  });

  it('opens no session when there is nothing to replay', async () => {
    const fake = makeFake(CLEAN);
    const flagged = await flaggedFixtures(fake.open, []);
    expect(flagged).toEqual([]);
    expect(fake.state.opens).toBe(0);
  });

  // Cleanup runs on the failure path, so a `finally` would let a context
  // that fails to close replace the error naming the offending fixture —
  // discarding the one diagnostic this replay exists to produce.
  it('keeps the fixture failure when cleanup fails too', async () => {
    const onClassify = new Error('fixture a.html did not load within 30000ms');
    const fake = makeDoomedFake(onClassify, new Error('context close failed'));
    const pending = flaggedFixtures(fake.open, FILES);
    await expect(pending).rejects.toThrow('fixture a.html did not load within 30000ms');
  });
});

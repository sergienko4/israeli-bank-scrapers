/**
 * Unit tests for the Mode A/B harvest mode primitives in
 * {@link ../../../Integration/Tools/ManifestRecorder.ts}.
 *
 * Phase 11 foundation tests — validate `parseHarvestMode` flag parsing,
 * `filterStepsByMode` Mode A trimming, and `dumpManifestTrafficIfMode`
 * Mode A no-op behaviour. The full traffic-dump file write path is
 * indirectly covered via the harvest CLI smoke-driven by per-bank work.
 *
 * @see ../../../Integration/Tools/ManifestRecorder.ts
 */

import type { IDumpManifestTrafficArgs } from '../../../Integration/Tools/ManifestRecorder.js';
import {
  dumpManifestTrafficIfMode,
  filterStepsByMode,
  parseHarvestMode,
} from '../../../Integration/Tools/ManifestRecorder.js';
import type {
  ICapturedResponse,
  IResponseBufferHandle,
} from '../../../Integration/Tools/NetworkResponseRecorder.js';
import type { IExtendedRecipe, IHarvestStep } from '../../../Integration/Tools/RecipeStepTypes.js';

const REVEAL_STEP: IHarvestStep = { kind: 'reveal', stepName: '00-pre', revealText: 'Login' };
const GOTO_STEP: IHarvestStep = { kind: 'goto', stepName: '01-home', url: 'https://example.test' };
const RECORD_STEP: IHarvestStep = {
  kind: 'recordResponse',
  stepName: '02-rec',
  urlPattern: '/api',
  captureAs: 'api',
};
const RECIPE: IExtendedRecipe = {
  bankId: 'hapoalim',
  steps: [GOTO_STEP, REVEAL_STEP, RECORD_STEP],
};

/** Successful drain sentinel reused across the noop buffer stub. */
const NOOP_DRAIN_RESULT = { drained: true as const, pendingAtStart: 0 };

/** Successful dispose sentinel reused across the noop buffer stub. */
const NOOP_DISPOSE_RESULT = { disposed: true as const };

/**
 * Empty `ICapturedResponse[]` literal, narrowed to readonly to satisfy
 * the buffer-handle snapshot signature without leaking `any`.
 */
const EMPTY_SNAPSHOT: readonly ICapturedResponse[] = [];

/**
 * Stub drain function for the noop buffer — returns the shared
 * sentinel without doing real work.
 * @returns Always-success drain status.
 */
function noopDrain(): Promise<typeof NOOP_DRAIN_RESULT> {
  return Promise.resolve(NOOP_DRAIN_RESULT);
}

/**
 * Stub snapshot function for the noop buffer — returns an empty
 * readonly captured-response list.
 * @returns Empty captured-response list.
 */
function noopSnapshot(): readonly ICapturedResponse[] {
  return EMPTY_SNAPSHOT;
}

/**
 * Stub dispose function for the noop buffer.
 * @returns Always-success dispose sentinel.
 */
function noopDispose(): typeof NOOP_DISPOSE_RESULT {
  return NOOP_DISPOSE_RESULT;
}

/**
 * Build a buffer handle whose `drain`/`snapshot`/`dispose` are stubs
 * that report success without touching real state.
 * @returns Noop buffer handle suitable for Mode B empty-buffer dumps.
 */
function makeNoopBuffer(): IResponseBufferHandle {
  return { drain: noopDrain, snapshot: noopSnapshot, dispose: noopDispose };
}

describe('parseHarvestMode', () => {
  it('returns "a" when --mode-a-harvest is present', () => {
    const mode = parseHarvestMode(['--mode-a-harvest']);
    expect(mode).toBe('a');
  });

  it('returns "b" when --mode-b-harvest is present', () => {
    const mode = parseHarvestMode(['--mode-b-harvest']);
    expect(mode).toBe('b');
  });

  it('throws when both flags are present', () => {
    /** Invoke parseHarvestMode with both flags to capture the rejection. */
    const invoke = (): void => {
      parseHarvestMode(['--mode-a-harvest', '--mode-b-harvest']);
    };
    expect(invoke).toThrow(/mutually exclusive/);
  });

  it('throws when neither flag is present', () => {
    /** Invoke parseHarvestMode with no flags to capture the rejection. */
    const invoke = (): void => {
      parseHarvestMode([]);
    };
    expect(invoke).toThrow(/must specify exactly one/);
  });
});

describe('filterStepsByMode', () => {
  it('mode "b" keeps every step verbatim', () => {
    const out = filterStepsByMode(RECIPE, 'b');
    expect(out).toBe(RECIPE);
  });

  it('mode "a" drops only recordResponse steps', () => {
    const out = filterStepsByMode(RECIPE, 'a');
    expect(out.steps).toHaveLength(2);
    const kinds = out.steps.map(s => s.kind);
    expect(kinds).toEqual(['goto', 'reveal']);
  });

  it('mode "a" preserves bankId', () => {
    const out = filterStepsByMode(RECIPE, 'a');
    expect(out.bankId).toBe('hapoalim');
  });
});

/** Capture flags used by the Mode A no-op tracking buffer. */
interface ITrackingFlags {
  wasDrained: boolean;
  wasSnapshotted: boolean;
}

/**
 * Build a tracking drain stub that flips `wasDrained` when invoked.
 * @param flags - Mutable tracking flags.
 * @returns Drain stub returning the noop sentinel.
 */
function makeTrackingDrain(flags: ITrackingFlags): () => Promise<typeof NOOP_DRAIN_RESULT> {
  return (): Promise<typeof NOOP_DRAIN_RESULT> => {
    flags.wasDrained = true;
    return Promise.resolve(NOOP_DRAIN_RESULT);
  };
}

/**
 * Build a tracking snapshot stub that flips `wasSnapshotted` when invoked.
 * @param flags - Mutable tracking flags.
 * @returns Snapshot stub returning the empty list sentinel.
 */
function makeTrackingSnapshot(flags: ITrackingFlags): () => readonly ICapturedResponse[] {
  return (): readonly ICapturedResponse[] => {
    flags.wasSnapshotted = true;
    return EMPTY_SNAPSHOT;
  };
}

/**
 * Build a buffer handle that records whether `drain`/`snapshot` are
 * ever invoked — used to assert Mode A is strictly a no-op.
 * @param flags - Mutable tracking flags (set when invoked).
 * @returns Tracking buffer handle.
 */
function makeTrackingBuffer(flags: ITrackingFlags): IResponseBufferHandle {
  return {
    drain: makeTrackingDrain(flags),
    snapshot: makeTrackingSnapshot(flags),
    dispose: noopDispose,
  };
}

describe('dumpManifestTrafficIfMode', () => {
  it('is a no-op for mode "a" — neither drains nor snapshots the buffer', async () => {
    const flags: ITrackingFlags = { wasDrained: false, wasSnapshotted: false };
    const buffer = makeTrackingBuffer(flags);
    const args: IDumpManifestTrafficArgs = {
      harvestMode: 'a',
      bankId: 'hapoalim',
      fixtureRoot: 'C:/tmp/nonexistent',
      buffer,
    };
    const promise = dumpManifestTrafficIfMode(args);
    await expect(promise).resolves.toBe(true);
    expect(flags.wasDrained).toBe(false);
    expect(flags.wasSnapshotted).toBe(false);
  });

  it('mode "b" with empty buffer resolves without error (snapshot empty)', async () => {
    const buffer = makeNoopBuffer();
    const args: IDumpManifestTrafficArgs = {
      harvestMode: 'b',
      bankId: 'hapoalim',
      fixtureRoot: 'C:/tmp/manifest-recorder-test',
      buffer,
    };
    const promise = dumpManifestTrafficIfMode(args);
    await expect(promise).resolves.toBe(true);
  });
});

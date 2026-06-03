/**
 * OTP-DETECTOR Sequential — short-circuiting reducer helpers.
 * Extracted so the OtpDetector orchestrator stays under the 150-LoC cap.
 */

interface IRunState {
  done: boolean;
}

/** Bundled args for {@link runStep} — under the 3-param ceiling. */
interface IStepArgs<T> {
  readonly state: IRunState;
  readonly results: boolean[];
  readonly action: (item: T, idx: number) => Promise<boolean>;
}

/**
 * Per-item step honouring the short-circuit flag in {@link IRunState}.
 * @param args - Bundle of short-circuit state, result slots, action.
 * @param item - Item to attempt.
 * @param idx - Position in the input array (used as result slot).
 * @returns Whether the action reported success for this item.
 */
async function runStep<T>(args: IStepArgs<T>, item: T, idx: number): Promise<boolean> {
  if (args.state.done) return false;
  const didSucceed = await args.action(item, idx);
  args.results[idx] = didSucceed;
  if (didSucceed) args.state.done = true;
  return didSucceed;
}

/** Reducer alias keeping single-line signatures. */
type SeqReducer<T> = (chain: Promise<boolean>, item: T, idx: number) => Promise<boolean>;

/**
 * Build the reducer arrow consumed by {@link runSequential}'s reduce.
 * @param args - Bundle of short-circuit state, result slots, action.
 * @returns Reducer accepted by `items.reduce<Promise<boolean>>(...)`.
 */
function buildSequentialReducer<T>(args: IStepArgs<T>): SeqReducer<T> {
  return (chain, item, idx) => chain.then(() => runStep(args, item, idx));
}

/** Per-item action alias. */
type SeqAction<T> = (item: T, idx: number) => Promise<boolean>;

/**
 * Run actions sequentially, short-circuiting after the first success.
 * @param items - Array of items to process.
 * @param action - Async action returning true on success.
 * @returns Array of boolean results (true/false per item).
 */
async function runSequential<T>(items: T[], action: SeqAction<T>): Promise<boolean[]> {
  const state: IRunState = { done: false };
  const results = items.map((): boolean => false);
  const args: IStepArgs<T> = { state, results, action };
  const reducer = buildSequentialReducer(args);
  const seedChain = Promise.resolve(false);
  await items.reduce<Promise<boolean>>((acc, item, idx) => reducer(acc, item, idx), seedChain);
  return results;
}

export default runSequential;

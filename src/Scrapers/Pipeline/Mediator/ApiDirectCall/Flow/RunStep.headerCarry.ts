/**
 * Response-header carry — a step's `headerExtractsToCarry` names a carry
 * slot per response header. The step hands its call a sink for exactly those
 * headers; after the answer each slot takes its header's value, else its
 * fallback, else the step fails `<step> header missing`. A step that carries
 * its final URL or resolves relative page captures gets a sink too, which
 * keeps the URL that answered.
 * Only the last answer counts: a call retried after a 401 drops the first
 * answer's headers and URL. Values are never logged.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IHeaderExtract, IStepConfig } from '../ConfigContracts/index.js';
import type { CarryMap, IDispatchBundle, IFireArgs, IHeaderCapture } from './RunStep.types.js';

/** A carry slot and the header it reads. */
type HeaderSlot = readonly [string, IHeaderExtract];

/** A carry slot and the value it takes. */
type CarriedSlot = readonly [string, string];

/** The writable stores behind a step's capture. */
interface IAnswerStore {
  readonly seen: Map<string, string>;
  readonly urls: string[];
}

/** The capture of a step that carries no headers. */
const NO_HEADERS: ReadonlyMap<string, string> = new Map();

/**
 * File the declared headers an answer carried, and the URL that gave it, into
 * the step's stores. Each answer replaces the last, so a retried call keeps
 * only its final answer's.
 * @param store - The step's stores.
 * @param headers - The declared headers the answer carried.
 * @param url - The URL that gave the answer.
 * @returns How many headers the step has captured.
 */
function keepAnswer(
  store: IAnswerStore,
  headers: Readonly<Record<string, string>>,
  url: string,
): number {
  store.seen.clear();
  for (const [name, value] of Object.entries(headers)) store.seen.set(name, value);
  store.urls.splice(0, store.urls.length, url);
  return store.seen.size;
}

/**
 * Build a step's capture: a sink for its declared headers and the stores the
 * sink fills.
 * @param step - Step config.
 * @returns The capture whose sink the call names.
 */
function captureOf(step: IStepConfig): IHeaderCapture {
  const slots = Object.values(step.headerExtractsToCarry ?? {});
  const names = slots.map((extract): string => extract.header.toLowerCase());
  const store: IAnswerStore = { seen: new Map(), urls: [] };
  /**
   * The sink's receiver: keeps an answer's headers and URL; the status is not read.
   * @param headers - The declared headers the answer carried.
   * @param _status - The answer's HTTP status.
   * @param url - The URL that gave the answer.
   * @returns How many headers the step has captured.
   */
  const take = (headers: Readonly<Record<string, string>>, _status: number, url: string): number =>
    keepAnswer(store, headers, url);
  return { sink: { names, take }, ...store };
}

/**
 * Whether a step needs its answer's headers or answering URL.
 * @param step - Step config.
 * @returns True when the step needs a capture.
 */
function isCapturing(step: IStepConfig): boolean {
  return (
    step.headerExtractsToCarry !== undefined ||
    step.finalUrlInto !== undefined ||
    step.formCapture !== undefined ||
    step.locationCapture !== undefined
  );
}

/**
 * Give a step's fire args a capture when it reads headers, its final URL or
 * relative URLs from its answer.
 * @param fire - Fire args without a capture.
 * @param step - Step config.
 * @returns Fire args whose call policy names the capture's sink, else `fire`.
 */
function attachHeaderCapture(fire: IFireArgs, step: IStepConfig): IFireArgs {
  if (!isCapturing(step)) return fire;
  const headerCapture = captureOf(step);
  const policy = { ...fire.policy, headerSink: headerCapture.sink };
  return { ...fire, policy, headerCapture };
}

/**
 * The value one carry slot takes from the captured headers.
 * @param seen - Captured headers, by lower-case name.
 * @param slot - The carry slot and the header it reads.
 * @returns The slot and its value, or false when header and fallback are absent.
 */
function carriedOf(seen: ReadonlyMap<string, string>, slot: HeaderSlot): CarriedSlot | false {
  const [name, extract] = slot;
  const header = extract.header.toLowerCase();
  const value = seen.get(header) ?? extract.fallback;
  if (value === undefined) return false;
  return [name, value];
}

/**
 * Whether a carry slot found its value.
 * @param carried - A slot and its value, or false.
 * @returns True when the slot has a value.
 */
function isCarried(carried: CarriedSlot | false): carried is CarriedSlot {
  return carried !== false;
}

/**
 * The failure of a step whose answer lacked a declared header.
 * @param stepName - The step's name.
 * @returns A Generic failure `<step> header missing`.
 */
function headerMissing(stepName: string): Procedure<CarryMap> {
  return fail(ScraperErrorTypes.Generic, `${stepName} header missing`);
}

/**
 * Read a step's header carry slots after its answer.
 * @param bundle - Dispatch bundle.
 * @returns Procedure with the header carry, or fail `<step> header missing`.
 */
function carryHeaders(bundle: IDispatchBundle): Procedure<CarryMap> {
  const step = bundle.fireScope.step;
  const seen = bundle.fireArgs.headerCapture?.seen ?? NO_HEADERS;
  const slots = Object.entries(step.headerExtractsToCarry ?? {});
  const carried = slots.map((slot): CarriedSlot | false => carriedOf(seen, slot));
  const present = carried.filter(isCarried);
  if (present.length < carried.length) return headerMissing(step.name);
  const carry: CarryMap = Object.fromEntries(present);
  return succeed(carry);
}

export { attachHeaderCapture, carryHeaders };

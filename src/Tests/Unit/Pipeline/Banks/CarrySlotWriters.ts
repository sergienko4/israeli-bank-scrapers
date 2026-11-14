/**
 * Every way a login config writes a carry slot. The step table names each
 * field of a step — a field added to the step contract fails to compile here
 * until it says whether, and how, it writes carry — so a contract test built
 * on it cannot miss a writer.
 */

import type {
  IApiDirectCallConfig,
  ICarryGenerator,
  IGetStep,
  IPostStep,
  IStepConfig,
} from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { structuredSlotsOf } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Captures/RunStep.structuredCapture.js';

/** One slot a config writes, and whether the write keeps a held value. */
interface ISlotWrite {
  readonly slot: string;
  readonly isKeepExisting: boolean;
}

/** The slots one step field writes. */
type SlotWriter = (step: IStepConfig) => readonly ISlotWrite[];

/**
 * Whether a slot name is set.
 * @param slot - Slot name, when set.
 * @returns True for a set name.
 */
function isSet(slot?: string): slot is string {
  return slot !== undefined;
}

/**
 * Plain writes of the named slots.
 * @param slots - Slot names.
 * @returns One write per slot, none keeping a held value.
 */
function plain(slots: readonly string[]): readonly ISlotWrite[] {
  return slots.map((slot): ISlotWrite => ({ slot, isKeepExisting: false }));
}

/**
 * Plain writes of a record's keys.
 * @param record - Slot-keyed record.
 * @returns One write per key.
 */
function keysOf(record: object): readonly ISlotWrite[] {
  const keys = Object.keys(record);
  return plain(keys);
}

/**
 * The slots a step's extracts write.
 * @param step - Login step.
 * @returns One write per slot.
 */
function extractWrites(step: IStepConfig): readonly ISlotWrite[] {
  return keysOf(step.extractsToCarry);
}

/**
 * The slots a step's header extracts write.
 * @param step - Login step.
 * @returns One write per slot.
 */
function headerWrites(step: IStepConfig): readonly ISlotWrite[] {
  return keysOf(step.headerExtractsToCarry ?? {});
}

/**
 * The slots a step's optional extracts write.
 * @param step - Login step.
 * @returns One write per slot, flagged when it keeps a held value.
 */
function optionalWrites(step: IStepConfig): readonly ISlotWrite[] {
  const entries = Object.entries(step.optionalExtractsToCarry ?? {});
  return entries.map(([slot, extract]): ISlotWrite => {
    return { slot, isKeepExisting: extract.keepExisting === true };
  });
}

/**
 * The slots a step's text captures write; an absence check writes none.
 * @param step - Login step.
 * @returns One write per present capture.
 */
function textCaptureWrites(step: IStepConfig): readonly ISlotWrite[] {
  const entries = Object.entries(step.textCaptures ?? {});
  const writing = entries.filter(([, capture]) => capture.absent !== true);
  const slots = writing.map(([slot]) => slot);
  return plain(slots);
}

/**
 * The slots a step's answer classifier writes: its case name and captures.
 * @param step - Login step.
 * @returns The case slot and every case's capture slots.
 */
function classifyWrites(step: IStepConfig): readonly ISlotWrite[] {
  const classifier = step.classify;
  if (classifier === undefined) return [];
  const captured = classifier.cases.flatMap(answerCase => Object.keys(answerCase.captures ?? {}));
  return plain([classifier.into, ...captured]);
}

/**
 * The slots one generator writes.
 * @param generator - Carry generator.
 * @returns Its set output slots.
 */
function generatorSlots(generator: ICarryGenerator): readonly string[] {
  if (generator.kind === 'pkcs10-csr') return [generator.into];
  if (generator.kind !== 'rsa-key') return [generator.publicInto, generator.privateInto];
  return [generator.keyInto, generator.spkiSha256HexInto].filter(isSet);
}

/**
 * The slots a step's generators write.
 * @param step - Login step.
 * @returns One write per generated slot.
 */
function generateWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = (step.generate ?? []).flatMap(generatorSlots);
  return plain(slots);
}

/**
 * The slots a step's derived carry writes.
 * @param step - Login step.
 * @returns One write per derived slot.
 */
function deriveWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = (step.deriveCarry ?? []).map(derived => derived.into);
  return plain(slots);
}

/**
 * The slots an exchange codec writes; a sealed codec writes none.
 * @param step - Login step.
 * @returns The key and session slots of an exchange.
 */
function codecWrites(step: IStepConfig): readonly ISlotWrite[] {
  const codec = step.codec;
  if (codec?.mode !== 'exchange') return [];
  return plain([codec.keyInto, codec.sessionInto]);
}

/**
 * The slot a step's form capture writes.
 * @param step - Login step.
 * @returns Its write, when set.
 */
function formWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = [step.formCapture?.into].filter(isSet);
  return plain(slots);
}

/**
 * The slot a step's redirect-location capture writes.
 * @param step - Login step.
 * @returns Its write, when set.
 */
function locationWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = [step.locationCapture?.into].filter(isSet);
  return plain(slots);
}

/**
 * The slot a structured capture writes.
 * @param step - Login step.
 * @returns Its write, when set.
 */
function structuredWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = structuredSlotsOf(step);
  return plain(slots);
}

/**
 * The slot a step's final URL writes.
 * @param step - Login step.
 * @returns Its write, when set.
 */
function finalUrlWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = [step.finalUrlInto].filter(isSet);
  return plain(slots);
}

/**
 * The slot a step's pre-hook writes.
 * @param step - Login step.
 * @returns Its write, when set.
 */
function preHookWrites(step: IStepConfig): readonly ISlotWrite[] {
  const slots = [step.preHook?.intoCarryField].filter(isSet);
  return plain(slots);
}

/**
 * A field that writes no carry slot.
 * @returns No writes.
 */
function none(): readonly ISlotWrite[] {
  return [];
}

/** How each step field writes carry. Seal and crypto fields write the body only. */
const STEP_WRITERS = {
  name: none,
  urlTag: none,
  method: none,
  body: none,
  encoding: none,
  extractsToCarry: extractWrites,
  optionalExtractsToCarry: optionalWrites,
  headerExtractsToCarry: headerWrites,
  textCaptures: textCaptureWrites,
  formCapture: formWrites,
  locationCapture: locationWrites,
  structuredCapture: structuredWrites,
  classify: classifyWrites,
  deriveCarry: deriveWrites,
  generate: generateWrites,
  codec: codecWrites,
  finalUrlInto: finalUrlWrites,
  preHook: preHookWrites,
  queryTemplate: none,
  rawQuery: none,
  cookieJar: none,
  headers: none,
  outcome: none,
  redirect: none,
  response: none,
  maxTextChars: none,
  documentMarker: none,
  mediaType: none,
  strictUtf8: none,
  responseIntegrity: none,
  seal: none,
  setCookies: none,
  clientCert: none,
  failIfPresent: none,
  bankErrorType: none,
  httpFailureMap: none,
  extractRules: none,
  runIf: none,
  urlFromCarry: none,
} satisfies Record<keyof IPostStep | keyof IGetStep, SlotWriter>;

/**
 * Every slot a step writes, by any field.
 * @param step - Login step.
 * @returns The step's writes.
 */
function stepWrites(step: IStepConfig): readonly ISlotWrite[] {
  const writers: readonly SlotWriter[] = Object.values(STEP_WRITERS);
  return writers.flatMap(writer => writer(step));
}

/**
 * Every slot a config writes before its first step: seeds and derived carry.
 * @param call - Login config.
 * @returns The flow-level writes.
 */
function flowWrites(call: IApiDirectCallConfig): readonly ISlotWrite[] {
  const seeds = (call.seedCarryFromCreds ?? []).map(seed =>
    typeof seed === 'string' ? seed : seed.field,
  );
  const derived = (call.derivedCarry ?? []).map(entry => entry.into);
  return plain([...seeds, ...derived]);
}

/**
 * Every write of one slot across a config's flow seeds and login steps.
 * @param call - Login config.
 * @param slot - Carry slot.
 * @returns The writes naming that slot.
 */
function writesOf(call: IApiDirectCallConfig, slot: string): readonly ISlotWrite[] {
  const all = [...flowWrites(call), ...call.steps.flatMap(stepWrites)];
  return all.filter(write => write.slot === slot);
}

export type { ISlotWrite };
export { stepWrites, writesOf };

/**
 * Per-destination root-logger registry.
 *
 * <p>One slot per resolved log file, so two overlapping executions each own a
 * logger bound to their own `pipeline.log`. A slot is retired by the run that
 * owns it, when that run ends — never because another run asked for a different
 * destination. That is what keeps one execution's cleanup from closing
 * another's live descriptor.
 *
 * <p>Outside every execution (log lines before a run starts, tests that switch
 * the process-global bank) the destination is "ambient": moving to a new file
 * retires the previous ambient one, exactly as a single shared root logger did.
 * The terminal-only slot (`''`) has no file or descriptor and is never retired.
 *
 * <p>The builder is injected, so this module does not depend on how a logger is
 * constructed.
 */
import type { Logger } from 'pino';

import type { IFileLease, ILeasedLoggerResult } from './FileLease.js';
import { retireSupersededLogger } from './RetireTransport.js';

/** One destination's logger, its descriptor lease and when it was built. */
interface ILoggerSlot {
  readonly logger: Logger;
  readonly lease: IFileLease | false;
  readonly generation: number;
}

/** Builds the logger and lease for one resolved log file. */
type SlotBuilder = (logFile: string) => ILeasedLoggerResult;

/** The ambient destination a lookup is for, or the running execution's own. */
interface ISlotRequest {
  readonly logFile: string;
  readonly isScoped: boolean;
  readonly build: SlotBuilder;
}

const SLOTS = new Map<string, ILoggerSlot>();
let ambientFile: string | false = false;
let sequence = 0;

/**
 * Retire one destination's logger and lease, and forget it.
 * @param logFile - The destination to retire.
 * @returns True when a slot was retired, false when the destination had none.
 */
function retireSlot(logFile: string): boolean {
  const slot = SLOTS.get(logFile);
  if (!slot) return false;
  SLOTS.delete(logFile);
  retireSupersededLogger(slot.logger, slot.lease);
  return true;
}

/**
 * Record the ambient destination, retiring the previous ambient file.
 * @param logFile - The destination an ambient lookup resolved to.
 * @returns True once recorded.
 */
function noteAmbient(logFile: string): true {
  const previous = ambientFile;
  ambientFile = logFile;
  if (previous !== false && previous !== logFile && previous !== '') retireSlot(previous);
  return true;
}

/**
 * Build and register the slot for a destination.
 * @param request - The destination and how to build it.
 * @returns The new slot.
 */
function openSlot(request: ISlotRequest): ILoggerSlot {
  const built = request.build(request.logFile);
  sequence += 1;
  const slot: ILoggerSlot = { logger: built.logger, lease: built.lease, generation: sequence };
  SLOTS.set(request.logFile, slot);
  return slot;
}

/**
 * The slot serving a destination, built on first use.
 * @param request - The destination and how to build it.
 * @returns The destination's slot.
 */
function slotFor(request: ISlotRequest): ILoggerSlot {
  const slot = SLOTS.get(request.logFile) ?? openSlot(request);
  if (!request.isScoped) noteAmbient(request.logFile);
  return slot;
}

/**
 * The generation of a destination's slot; changes exactly when its logger does.
 * @param logFile - The destination.
 * @returns Its slot's generation, or the latest one when it has no slot yet.
 */
function generationFor(logFile: string): number {
  return SLOTS.get(logFile)?.generation ?? sequence;
}

/**
 * The descriptor lease of a destination, for unit-test cleanup assertions.
 * @param logFile - The destination.
 * @returns Its lease, or `false` when it has none.
 */
function leaseFor(logFile: string): IFileLease | false {
  return SLOTS.get(logFile)?.lease ?? false;
}

/**
 * Retire the destination a finished run owned. A terminal-only destination is
 * shared by every run and is left alone.
 * @param logFile - The finished run's recorded destination, or `false` when it had none.
 * @returns True when a slot was retired.
 */
function retireRunSlot(logFile: string | false): boolean {
  return logFile !== false && logFile.length > 0 && retireSlot(logFile);
}

export type { ILoggerSlot, ISlotRequest, SlotBuilder };
export { generationFor, leaseFor, retireRunSlot, slotFor };

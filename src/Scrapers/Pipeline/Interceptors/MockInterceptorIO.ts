/**
 * MockInterceptor I/O — filesystem helpers for reading phase snapshots
 * and building the Playwright route handler. Separated from MockInterceptor
 * to keep that file under the Pipeline 150-line limit.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BrowserContext } from 'playwright-core';

import { buildHandler } from './MockRouteHandler.js';

/** Root directory where snapshots are read from. */
const SNAPSHOT_ROOT = 'tests/snapshots';

/** Phase name currently active for mock replay. */
type ActivePhaseName = string;
/** Snapshot HTML most recently served to a request. */
type LastServedHtml = string;
/** Whether context.route('**\/*', ...) is installed for this bank. */
type IsRouted = boolean;
/** Bank identifier — key for per-company state and snapshot dir. */
type CompanyId = string;
/** Absolute snapshot file path on disk. */
type SnapshotPath = string;
/** HTML body read from a snapshot (or generated placeholder). */
type SnapshotHtml = string;

/** State shared with the MockInterceptor. */
export interface IMockState {
  currentPhase: ActivePhaseName;
  lastServed: LastServedHtml;
  isRouted: IsRouted;
}

/** Module-scoped state per companyId so INIT-time install and the interceptor share it. */
const STATES = new Map<string, IMockState>();

/**
 * Get or create the mock state for a given company. Shared between the
 * INIT-time route installer and the runtime beforePhase interceptor so
 * they mutate the same currentPhase / isRouted flags.
 * @param companyId - Bank identifier.
 * @returns The singleton state for this bank in this process.
 */
export function getMockState(companyId: CompanyId): IMockState {
  const existing = STATES.get(companyId);
  if (existing) return existing;
  const fresh: IMockState = { currentPhase: 'init', lastServed: '', isRouted: false };
  STATES.set(companyId, fresh);
  return fresh;
}

/** Route handler outcome — true after fulfilment. */
type RouteResult = boolean;

/**
 * Try reading a snapshot file; returns empty string when missing.
 * @param filePath - Absolute snapshot file path.
 * @returns File contents or empty string.
 */
function tryReadSnapshot(filePath: SnapshotPath): SnapshotHtml {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Build the placeholder HTML served when no snapshot and no previous HTML exist.
 * @param companyId - Bank id for the message.
 * @param phase - Phase name for the message.
 * @returns Placeholder HTML.
 */
function placeholderHtml(companyId: CompanyId, phase: ActivePhaseName): SnapshotHtml {
  return `<html><body>no snapshot: ${companyId}/${phase}</body></html>`;
}

/**
 * Compose the absolute path to a snapshot file for a given bank + phase.
 * @param companyId - Bank directory.
 * @param phase - Phase name (used as filename).
 * @returns Absolute snapshot file path.
 */
function snapshotPath(companyId: CompanyId, phase: ActivePhaseName): SnapshotPath {
  const cwd = process.cwd();
  const filename = `${phase}.html`;
  return path.join(cwd, SNAPSHOT_ROOT, companyId, filename);
}

/**
 * Resolve the HTML body to serve for the current phase, with fallback.
 * @param companyId - Bank identifier (directory).
 * @param phase - Current phase name.
 * @param lastHtml - HTML served on the previous request (fallback).
 * @returns HTML string to serve.
 */
export function resolveMockHtml(
  companyId: CompanyId,
  phase: ActivePhaseName,
  lastHtml: LastServedHtml,
): SnapshotHtml {
  const file = snapshotPath(companyId, phase);
  const fromDisk = tryReadSnapshot(file);
  if (fromDisk) return fromDisk;
  if (lastHtml) return lastHtml;
  return placeholderHtml(companyId, phase);
}

/**
 * Check whether MOCK_MODE is active via env var.
 * @returns True when MOCK_MODE is '1' or 'true'.
 */
function isMockActive(): RouteResult {
  const val = process.env.MOCK_MODE;
  return val === '1' || val === 'true';
}

/**
 * Install the mock route on a BrowserContext when MOCK_MODE is enabled.
 * Called from INIT.pre so the first page.goto is already intercepted.
 * Idempotent via state.isRouted. Seeds currentPhase='home' so the initial
 * navigation serves home.html; subsequent phases overwrite via beforePhase.
 * @param context - Playwright BrowserContext to route.
 * @param companyId - Bank identifier (keys shared state + snapshot dir).
 * @returns True if routes installed, false when MOCK_MODE unset or already routed.
 */
export async function installMockContextRoute(
  context: BrowserContext,
  companyId: CompanyId,
): Promise<RouteResult> {
  if (!isMockActive()) return false;
  const state = getMockState(companyId);
  if (state.isRouted) return true;
  state.currentPhase = 'home';
  const handler = buildHandler(companyId, state);
  await context.route('**/*', handler);
  state.isRouted = true;
  return true;
}

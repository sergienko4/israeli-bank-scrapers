import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';
import { parse } from 'yaml';

import { captureFibiEntry } from '../../../../.github/scripts/ci/capture-fibi-entry.mjs';
import { fakeFetch, serving } from '../../Helpers/FakeFetch.js';
import { canRunPosixBash } from '../../Helpers/HostCapabilities.js';
import { readRepoFile } from '../../Helpers/RepoFiles.js';
import { createTempRepo } from '../../Helpers/TempRepoTree.js';

const ROOTS: string[] = [];
const BODY = '<html><title>SYNTHETIC-PRIVATE-TEXT</title></html>';

/**
 * Allocate an isolated run root.
 * @returns Private fixture path.
 */
function makeRoot(): string {
  const root = createTempRepo();
  ROOTS.push(root);
  return root;
}

afterEach(() => {
  jest.restoreAllMocks();
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('[FIBI-CAP-1] makes one anonymous GET and saves only its body in a private leaf', async () => {
  const root = makeRoot();
  const fake = serving(BODY);
  const observed = await captureFibiEntry(root, fake.fetchImpl);
  expect(fake.calls).toHaveLength(1);
  const { url, init } = fake.calls[0];
  expect(url).toBe(
    'https://online.fibi.co.il/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE',
  );
  expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
  expect(init.body).toBeUndefined();
  expect(init.signal).toBeDefined();
  const headers = new Headers(init.headers);
  const recorded = Object.fromEntries(headers);
  expect(recorded).toEqual({
    accept: 'text/html,application/xhtml+xml',
    'user-agent': 'BankApiInteroperabilityResearch/1.0',
  });
  expect(observed).toEqual({ status: 200, bytes: BODY.length, textLength: BODY.length });
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const bodyFile = entries.find(entry => entry.name === 'entry.body.txt');
  if (bodyFile === undefined) throw new RangeError('missing private body fixture');
  const file = `${bodyFile.parentPath}/${bodyFile.name}`;
  const content = readFileSync(file, 'utf8');
  expect(content).toBe(BODY);
  if (canRunPosixBash(process.platform)) {
    const fileMode = statSync(file).mode & 0o777;
    const parentMode = statSync(bodyFile.parentPath).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(parentMode).toBe(0o700);
  }
});

it('[FIBI-CAP-2] enforces the byte ceiling without retrying or retaining a partial body', async () => {
  const root = makeRoot();
  const body = 'x'.repeat(2_097_153);
  const fake = serving(body);
  const pending = captureFibiEntry(root, fake.fetchImpl);
  await expect(pending).rejects.toThrow('FIBI_ENTRY_BODY_LIMIT');
  expect(fake.calls).toHaveLength(1);
  const files = readdirSync(root, { recursive: true });
  expect(files).toEqual([]);
});

it('[FIBI-CAP-3] does not retain redirect or cookie headers or follow another endpoint', async () => {
  const root = makeRoot();
  const marker = 'SYNTHETIC-HEADER-SECRET';
  const fake = fakeFetch(
    (): Response =>
      new Response('', {
        status: 302,
        headers: { location: `https://example.invalid/${marker}`, 'set-cookie': marker },
      }),
  );
  const observed = await captureFibiEntry(root, fake.fetchImpl);
  expect(fake.calls).toHaveLength(1);
  expect(observed).toEqual({ status: 302, bytes: 0, textLength: 0 });
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  for (const entry of entries.filter(item => item.isFile())) {
    const content = readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8');
    expect(content).not.toContain(marker);
  }
});

it('[FIBI-CAP-4] bounds the request deadline and surfaces cancellation without retry', async () => {
  const root = makeRoot();
  const failure = new DOMException('synthetic timeout', 'TimeoutError');
  const signal = AbortSignal.abort(failure);
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
  const invoke = jest.fn<Promise<Response>, [string, RequestInit]>((_url, init) => {
    init.signal?.throwIfAborted();
    return Promise.resolve(new Response(BODY));
  });
  const pending = captureFibiEntry(root, invoke);
  await expect(pending).rejects.toThrow('synthetic timeout');
  expect(timeout).toHaveBeenCalledWith(20_000);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('[FIBI-CAP-5] runs only after Beinleumi E2E fails, before the existing private upload', () => {
  const text = readRepoFile('.github/workflows/pr.yml');
  const workflow = parse(text) as {
    jobs: Record<
      string,
      { steps: { id?: string; name?: string; run?: string; if?: string; env?: unknown }[] }
    >;
  };
  const steps = workflow.jobs['e2e-real-group-b'].steps;
  const capture = steps.findIndex(
    step => step.run === 'node .github/scripts/ci/capture-fibi-entry.mjs',
  );
  expect(capture).toBeGreaterThan(0);
  expect(steps[capture - 1].id).toBe('bank_e2e');
  expect(steps[capture].if).toBe(
    "${{ !cancelled() && matrix.bank == 'Beinleumi' && steps.bank_e2e.outcome == 'failure' }}",
  );
  expect(steps[capture].env).toEqual({ RUNS_ROOT: '/tmp/runs' });
  expect(steps[capture]).not.toHaveProperty('continue-on-error');
  expect(steps[capture]).toMatchObject({ 'timeout-minutes': 1 });
  expect(steps[capture + 1].run).toBe('bash .github/scripts/ci/upload-private-diagnostics.sh');
});

it('[FIBI-CAP-6] accepts the exact UTF-8 byte limit without truncation', async () => {
  const root = makeRoot();
  const body = '\u05d0'.repeat(1_048_576);
  const fake = serving(body);
  const observed = await captureFibiEntry(root, fake.fetchImpl);
  expect(observed).toEqual({ status: 200, bytes: 2_097_152, textLength: 1_048_576 });
  expect(fake.calls).toHaveLength(1);
});

it('[FIBI-CAP-7] the CLI fails explicitly without printing private exception details', () => {
  const root = makeRoot();
  const source =
    "globalThis.fetch = async () => { throw new TypeError('SYNTHETIC-PRIVATE-ERROR'); };";
  const encoded = encodeURIComponent(source);
  const preload = `data:text/javascript,${encoded}`;
  const url = new URL('../../../../.github/scripts/ci/capture-fibi-entry.mjs', import.meta.url);
  const script = fileURLToPath(url);
  const result = spawnSync(process.execPath, ['--import', preload, script], {
    env: { ...process.env, RUNS_ROOT: root },
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('FIBI_ENTRY_CAPTURE_FAILED\n');
});

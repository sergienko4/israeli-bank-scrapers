import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ENTRY =
  'https://online.fibi.co.il/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE';
const MAX_BYTES = 2_097_152;
const TIMEOUT_MS = 20_000;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'user-agent': 'BankApiInteroperabilityResearch/1.0',
};

/**
 * Collect a bounded response without following redirects or retaining headers.
 * @param {Response} response Anonymous response.
 * @param {AbortController} controller Request-local cancellation.
 * @returns {Promise<Buffer>} Complete bytes; oversized bodies fail, not truncate.
 */
async function boundedBody(response, controller) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > MAX_BYTES) {
      controller.abort();
      throw new RangeError('FIBI_ENTRY_BODY_LIMIT');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

/**
 * Capture one fresh public GET, separate from the scraper's authenticated session.
 * @param {string} root Existing private archive root.
 * @param {(url: string, init: RequestInit) => Promise<Response>} invoke HTTP seam.
 * @returns {Promise<{status: number, bytes: number, textLength: number}>} Numeric metadata only.
 */
export async function captureFibiEntry(root, invoke = globalThis.fetch) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const response = await invoke(ENTRY, {
    method: 'GET',
    headers: HEADERS,
    credentials: 'omit',
    redirect: 'manual',
    signal,
  });
  const bytes = await boundedBody(response, controller);
  const parent = path.join(root, 'pipeline');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, 'anonymous-fibi-entry-'));
  await writeFile(path.join(directory, 'entry.body.txt'), bytes, { mode: 0o600, flag: 'wx' });
  const observed = {
    status: response.status,
    bytes: bytes.length,
    textLength: bytes.toString('utf8').length,
  };
  await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(observed), {
    mode: 0o600,
    flag: 'wx',
  });
  return observed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const observed = await captureFibiEntry(process.env.RUNS_ROOT ?? '/tmp/runs');
    console.log(JSON.stringify({ event: 'anonymous-fibi-entry', ...observed }));
  } catch {
    console.error('FIBI_ENTRY_CAPTURE_FAILED');
    process.exitCode = 1;
  }
}

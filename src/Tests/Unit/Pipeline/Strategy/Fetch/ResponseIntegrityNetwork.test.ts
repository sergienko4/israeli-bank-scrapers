/**
 * Native fetch integrity applies to post-decompression bytes on a local server.
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { cappedNative } from '../../../../Helpers/CappedTransport.js';

/**
 * Waits for the local server to close.
 * @param server - Test-only server.
 * @returns Completion or the server's close error.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('response integrity over native fetch', () => {
  it('limits and hashes decompressed bytes, not compressed wire bytes', async () => {
    const text = 'synthetic-bank-response:'.repeat(128);
    const body = Buffer.from(text, 'utf8');
    const compressed = gzipSync(body);
    const server = createServer((_request, reply) => {
      reply.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
      reply.end(compressed);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const { port } = server.address() as AddressInfo;
      const strategy = cappedNative(`http://127.0.0.1:${String(port)}/`);
      const tooSmall = await strategy.fetchGet('data', {
        extraHeaders: {},
        responseKind: 'text',
        responseIntegrity: { maxBytes: compressed.length },
      });
      expect(tooSmall).toMatchObject({ success: false });
      const sha256 = createHash('sha256').update(body).digest('hex');
      const matching = await strategy.fetchGet('data', {
        extraHeaders: {},
        responseKind: 'text',
        responseIntegrity: { maxBytes: body.length, sha256 },
      });
      expect(matching).toMatchObject({ success: true, value: { text: body.toString('utf8') } });
    } finally {
      await closeServer(server);
    }
  });

  it('aborts an oversized response that remains open', async () => {
    const body = 'x'.repeat(1024);
    const server = createServer((_request, reply) => {
      reply.writeHead(200, { 'content-type': 'text/plain' });
      reply.write(body);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const watchdog = AbortSignal.timeout(2_000);
    /**
     * Unblocks the test if stream cleanup fails to finish.
     * @returns True once connections are closed.
     */
    const onWatchdog = (): boolean => {
      server.closeAllConnections();
      return true;
    };
    watchdog.addEventListener('abort', onWatchdog);
    try {
      const { port } = server.address() as AddressInfo;
      const strategy = cappedNative(`http://127.0.0.1:${String(port)}/`);
      const result = await strategy.fetchGet('data', {
        extraHeaders: {},
        responseKind: 'text',
        responseIntegrity: { maxBytes: 64 },
      });
      expect(result).toMatchObject({
        success: false,
        errorMessage: 'response exceeds integrity byte limit',
      });
      expect(watchdog.aborted).toBe(false);
    } finally {
      watchdog.removeEventListener('abort', onWatchdog);
      server.closeAllConnections();
      await closeServer(server);
    }
  });
});

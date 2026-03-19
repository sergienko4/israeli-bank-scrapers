#!/usr/bin/env node
/**
 * Auto-tracing bank login recorder.
 * Opens Camoufox, navigates to bank URL, and AUTO-DUMPS all frames
 * on every navigation event. No ENTER needed — just do your flow.
 * Type "quit" when done.
 *
 * Usage: npx tsx scripts/trace-bank.ts [url]
 * All output saved to C:/tmp/trace-bank.log
 */
import * as fs from 'node:fs';

process.env.LOG_LEVEL = 'trace';
process.env.CI = '1';
process.env.NODE_ENV = 'production';

const url = process.argv[2] ?? 'https://www.fibi.co.il/private/';
const logPath = 'C:/tmp/trace-bank.log';
fs.writeFileSync(logPath, `=== trace started at ${new Date().toISOString()} ===\n\n`);

const fd = fs.openSync(logPath, 'a');
const origStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
  const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
  fs.writeSync(fd, text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''));
  return origStdout(chunk, ...args);
}) as typeof process.stdout.write;

const { launchCamoufox } = await import('../src/Common/CamoufoxLauncher.js');
const browser = await launchCamoufox(false);
const context = await browser.newContext();
const page = await context.newPage();

console.log(`\n🏦 Browser open → ${url}`);
console.log(`📄 Auto-trace log: ${logPath}`);
console.log('Just do your login flow. Every navigation auto-dumps.');
console.log('Type "quit" + ENTER when done.\n');

let dumpCounter = 0;

const dumpFrames = async (trigger: string): Promise<void> => {
  dumpCounter += 1;
  const frames = page.frames();
  console.log(`\n${'#'.repeat(80)}`);
  console.log(`  DUMP #${String(dumpCounter)} — trigger: ${trigger}`);
  console.log(`  Time: ${new Date().toISOString().slice(11, 23)}`);
  console.log(`  URL: ${page.url()}`);
  console.log(`  Frames: ${String(frames.length)}`);
  console.log(`${'#'.repeat(80)}`);
  for (const frame of frames) {
    const frameUrl = frame.url();
    if (frameUrl === 'about:blank') {
      console.log(`\n--- Frame: about:blank (empty) ---`);
      continue;
    }
    const dump = await frame.evaluate(() => {
      const body = document.body;
      if (!body) return '(no body)';
      const text = body.innerText?.slice(0, 500)?.replaceAll('\n', ' | ') ?? '';
      const els = Array.from(body.querySelectorAll(
        'input, button, select, textarea, a[href], label, [role="button"], [type="submit"]',
      ));
      const info = els.map(el => {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') ?? '';
        const name = el.getAttribute('name') ?? '';
        const id = el.getAttribute('id') ?? '';
        const val = el.getAttribute('value')?.slice(0, 30) ?? '';
        const txt = el.textContent?.trim().slice(0, 50) ?? '';
        const ph = el.getAttribute('placeholder') ?? '';
        const aria = el.getAttribute('aria-label') ?? '';
        const htmlFor = el.getAttribute('for') ?? '';
        const href = el.getAttribute('href')?.slice(0, 60) ?? '';
        const parts = [`<${tag}`];
        if (type) parts.push(`type="${type}"`);
        if (id) parts.push(`id="${id}"`);
        if (name) parts.push(`name="${name}"`);
        if (val) parts.push(`value="${val}"`);
        if (ph) parts.push(`placeholder="${ph}"`);
        if (aria) parts.push(`aria="${aria}"`);
        if (htmlFor) parts.push(`for="${htmlFor}"`);
        if (href) parts.push(`href="${href}"`);
        if (txt) parts.push(`text="${txt}"`);
        parts.push('>');
        return '  ' + parts.join(' ');
      }).join('\n');
      return `TEXT(500): ${text}\n\nALL ${String(els.length)} elements:\n${info}`;
    }).catch(() => '(inaccessible frame)');
    console.log(`\n--- Frame: ${frameUrl.slice(0, 120)} ---`);
    console.log(dump);
  }
  console.log(`\n${'#'.repeat(80)}\n`);
};

page.on('framenavigated', (frame) => {
  const frameUrl = frame.url();
  if (frameUrl === 'about:blank') return;
  console.log(`[NAV] ${frameUrl.slice(0, 120)}`);
  setTimeout(() => { dumpFrames(`framenavigated → ${frameUrl.slice(0, 60)}`).catch(() => {}); }, 2000);
});

await page.goto(url);
await page.waitForTimeout(3000);
await dumpFrames('initial page load');

// Auto-dump every 5 seconds to capture in-frame content changes (like OTP screens)
setInterval(() => { dumpFrames('periodic (5s)').catch(() => {}); }, 5000);

const rl = await import('node:readline');
const reader = rl.createInterface({ input: process.stdin, output: process.stdout });
const askLoop = (): void => {
  reader.question('[type "quit" to exit]: ', async (answer) => {
    if (answer.trim().toLowerCase() === 'quit') {
      await browser.close();
      process.exit(0);
    }
    await dumpFrames('manual ENTER');
    askLoop();
  });
};
askLoop();

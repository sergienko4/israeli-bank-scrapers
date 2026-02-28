/**
 * Full DOM-change recorder for the Beinleumi login flow.
 *
 * Records:
 *  1. Playwright trace (screenshots + DOM snapshots — replayable with `npx playwright show-trace`)
 *  2. MutationObserver in every frame: every element added/removed/shown/hidden → dom-changes.json
 *  3. isTrusted interceptor in #loginFrame: logs whether #sendSms click handler checks isTrusted
 *  4. Auto-snapshot of all frames on every navigation → .beinleumi-debug/dom-recording/
 *
 * Usage:
 *   npx ts-node scripts/record-dom-changes.ts
 *
 * Then manually log in (including OTP). Type "done" + Enter when on dashboard.
 * Outputs:
 *   .beinleumi-debug/dom-recording/  — per-navigation HTML snapshots
 *   .beinleumi-debug/trace.zip       — Playwright trace (open with npx playwright show-trace)
 *   .beinleumi-debug/dom-changes.json — MutationObserver log
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright';
import { buildContextOptions } from '../src/helpers/browser';

const OUT_DIR = path.join(process.cwd(), '.beinleumi-debug', 'dom-recording');
const TRACE_PATH = path.join(process.cwd(), '.beinleumi-debug', 'trace.zip');
const DOM_CHANGES_PATH = path.join(process.cwd(), '.beinleumi-debug', 'dom-changes.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Mutation buffer (flushed to disk periodically) ───────────────────────────

interface MutationEntry {
  t: number;
  frameUrl: string;
  kind: 'childList' | 'attributes' | 'nav' | 'isTrusted';
  target?: string;
  added?: string[];
  removed?: string[];
  attr?: string;
  oldVal?: string | null;
  newVal?: string | null;
  detail?: string;
}

const mutations: MutationEntry[] = [];

function pushMutation(entry: MutationEntry) {
  mutations.push(entry);
  fs.writeFileSync(DOM_CHANGES_PATH, JSON.stringify(mutations, null, 2));
}

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

let snapIndex = 0;

async function snapshotAllFrames(page: Page, label: string): Promise<void> {
  snapIndex++;
  const prefix = `${String(snapIndex).padStart(3, '0')}_${label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`;
  await page.screenshot({ path: path.join(OUT_DIR, `${prefix}.png`), fullPage: false }).catch(() => {});

  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    await snapshotFrame(frames[i], prefix, i);
  }
}

async function snapshotFrame(frame: Frame, prefix: string, idx: number): Promise<void> {
  const url = frame.url();
  if (!url || url === 'about:blank') return;
  try {
    const html = await frame.evaluate(() => document.documentElement.outerHTML);
    const slug = url.replace(/[^a-zA-Z0-9]/g, '_').slice(-50);
    fs.writeFileSync(path.join(OUT_DIR, `${prefix}_f${idx}_${slug}.html`), html);

    // Capture visibility state of key OTP elements
    const visibility = await frame.evaluate(() => {
      const ids = ['sendSms', 'codeinput', 'continueBtn', 'username', 'password', 'loginFrame'];
      return ids.map(id => {
        const el = document.getElementById(id);
        if (!el) return `${id}: absent`;
        const s = window.getComputedStyle(el);
        return `${id}: display=${s.display} visibility=${s.visibility} height=${el.offsetHeight}px`;
      });
    }).catch(() => []);

    if (visibility.length) {
      fs.writeFileSync(
        path.join(OUT_DIR, `${prefix}_f${idx}_visibility.txt`),
        `URL: ${url}\n${visibility.join('\n')}`,
      );
    }
  } catch {
    // cross-origin or detached — skip
  }
}

// ─── MutationObserver injection ───────────────────────────────────────────────

/**
 * Injects a MutationObserver + isTrusted interceptor into `frame`.
 * Changes are buffered in window.__mutations and exposed via window.__flushMutations().
 */
async function injectObserver(frame: Frame): Promise<void> {
  try {
    await frame.evaluate(() => {
      if ((window as any).__mutationObserverInjected) return;
      (window as any).__mutationObserverInjected = true;
      (window as any).__mutationBuffer = [] as string[];

      const buf = (window as any).__mutationBuffer as string[];

      const observer = new MutationObserver(muts => {
        for (const m of muts) {
          const targetId =
            (m.target as Element).id ||
            (m.target as Element).className?.toString().slice(0, 30) ||
            m.target.nodeName;

          if (m.type === 'childList') {
            const added = Array.from(m.addedNodes)
              .filter(n => n.nodeType === 1)
              .map(n => (n as Element).outerHTML.slice(0, 300));
            const removed = Array.from(m.removedNodes)
              .filter(n => n.nodeType === 1)
              .map(n => (n as Element).outerHTML.slice(0, 300));
            if (added.length || removed.length) {
              buf.push(JSON.stringify({ type: 'childList', target: targetId, added, removed }));
            }
          } else if (m.type === 'attributes') {
            const el = m.target as Element;
            buf.push(
              JSON.stringify({
                type: 'attributes',
                target: `${el.tagName}#${el.id || ''}`,
                attr: m.attributeName,
                oldVal: m.oldValue,
                newVal: el.getAttribute(m.attributeName ?? ''),
              }),
            );
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['style', 'class', 'hidden', 'disabled', 'display', 'aria-hidden'],
      });

      // isTrusted interceptor — logs every click and whether it was trusted
      document.addEventListener(
        'click',
        e => {
          const tgt = e.target as Element;
          buf.push(
            JSON.stringify({
              type: 'isTrusted',
              target: `${tgt?.tagName}#${tgt?.id || ''}`,
              isTrusted: e.isTrusted,
            }),
          );
        },
        true, // capture phase — fires before any handler
      );

      (window as any).__flushMutations = () => {
        const copy = [...buf];
        buf.length = 0;
        return copy;
      };
    });
  } catch {
    // detached or cross-origin before JS is ready — skip
  }
}

// ─── Flush loop: pull mutations from each frame every 1s ─────────────────────

async function flushFrame(frame: Frame): Promise<void> {
  const url = frame.url();
  if (!url || url === 'about:blank') return;
  try {
    const entries = await frame.evaluate(() => {
      const flush = (window as any).__flushMutations;
      return flush ? flush() : [];
    });
    for (const raw of entries as string[]) {
      const parsed = JSON.parse(raw) as Omit<MutationEntry, 't' | 'frameUrl'>;
      pushMutation({ t: Date.now(), frameUrl: url.slice(-80), ...parsed });
    }
  } catch {
    // detached — skip
  }
}

async function startFlushLoop(page: Page): Promise<NodeJS.Timeout> {
  return setInterval(async () => {
    for (const frame of page.frames()) {
      await flushFrame(frame);
    }
  }, 1000);
}

// ─── Frame event wiring ───────────────────────────────────────────────────────

function wireFrameEvents(page: Page): void {
  page.on('framenavigated', async frame => {
    const url = frame.url();
    const isMain = frame === page.mainFrame();
    console.log(`[NAV${isMain ? ':MAIN' : ':FRAME'}] ${url.slice(0, 100)}`);

    pushMutation({ t: Date.now(), frameUrl: url.slice(-80), kind: 'nav', detail: url });

    // Re-inject observer after navigation (page context is replaced)
    await injectObserver(frame);

    // Auto-snapshot all frames
    const label = `nav_${url.replace(/[^a-zA-Z0-9]/g, '_').slice(-30)}`;
    await snapshotAllFrames(page, label);
  });

  page.on('frameattached', async frame => {
    console.log(`[FRAME-ATTACHED] ${frame.url().slice(0, 80)}`);
    // Inject as early as possible (may fail if not loaded yet — framenavigated will retry)
    await injectObserver(frame);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function waitForDone(): Promise<void> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin });
    console.log('\n========================================');
    console.log('Browser is open. Do the FULL manual login:');
    console.log('  1. Click login trigger');
    console.log('  2. Enter username + password');
    console.log('  3. Submit credentials');
    console.log('  4. On the OTP screen: click "שלח" manually');
    console.log('  5. Enter the SMS code');
    console.log('  6. Submit OTP');
    console.log('  7. Wait until dashboard loads');
    console.log('');
    console.log('Type "done" + Enter when the dashboard is visible.');
    console.log('========================================\n');

    rl.on('line', line => {
      if (line.trim().toLowerCase() === 'done') {
        rl.close();
        resolve();
      }
    });
  });
}

async function startTrace(context: BrowserContext): Promise<void> {
  await context.tracing.start({
    screenshots: true,
    snapshots: true,   // DOM + CSS snapshots at every action
    sources: false,
  });
}

async function stopTrace(context: BrowserContext): Promise<void> {
  await context.tracing.stop({ path: TRACE_PATH });
  console.log(`\nTrace saved → ${TRACE_PATH}`);
  console.log(`View with:  npx playwright show-trace "${TRACE_PATH}"`);
}

async function main(): Promise<void> {
  console.log('Starting DOM recorder...');
  console.log(`  Snapshots → ${OUT_DIR}`);
  console.log(`  Trace     → ${TRACE_PATH}`);
  console.log(`  Mutations → ${DOM_CHANGES_PATH}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(buildContextOptions());
  const page = await context.newPage();

  await startTrace(context);
  wireFrameEvents(page);

  // Initial inject for the first page load
  await page.goto('https://www.fibi.co.il/private');
  await injectObserver(page.mainFrame());
  await snapshotAllFrames(page, 'initial');

  const flushTimer = await startFlushLoop(page);

  await waitForDone();

  clearInterval(flushTimer);

  // Final flush + snapshot
  for (const frame of page.frames()) await flushFrame(frame);
  await snapshotAllFrames(page, 'final_dashboard');

  await stopTrace(context);

  console.log(`\nDOM changes: ${mutations.length} entries → ${DOM_CHANGES_PATH}`);
  console.log(`Snapshots:   ${OUT_DIR}`);

  await browser.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

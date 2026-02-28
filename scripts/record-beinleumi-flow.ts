/**
 * Records the full Beinleumi login flow step by step.
 * The user does everything manually; this script captures the HTML at each step.
 *
 * Usage: npx ts-node scripts/record-beinleumi-flow.ts
 * Then follow the instructions in the browser and terminal.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { buildContextOptions } from '../src/helpers/browser';

dotenv.config();

const DEBUG_DIR = path.join(process.cwd(), '.beinleumi-debug', 'recording');
const READY_FILE = path.join(process.cwd(), '.beinleumi-step.tmp');

fs.mkdirSync(DEBUG_DIR, { recursive: true });
if (fs.existsSync(READY_FILE)) fs.unlinkSync(READY_FILE);

function waitForStep(): Promise<string> {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (fs.existsSync(READY_FILE)) {
        const label = fs.readFileSync(READY_FILE, 'utf-8').trim();
        clearInterval(interval);
        fs.unlinkSync(READY_FILE);
        resolve(label);
      }
    }, 500);
  });
}

async function captureState(page: any, label: string): Promise<void> {
  const safe = label.replace(/[^a-zA-Z0-9]/g, '_');
  const ts = Date.now();

  // Screenshot of main page
  await page.screenshot({ path: path.join(DEBUG_DIR, `${safe}_${ts}.png`), fullPage: false }).catch(() => {});

  // Main page HTML
  const mainHtml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
  fs.writeFileSync(path.join(DEBUG_DIR, `${safe}_main.html`), mainHtml);

  // All frames HTML
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const frameUrl = frame.url();
    if (!frameUrl || frameUrl === 'about:blank') continue;
    try {
      const html = await frame.evaluate(() => document.documentElement.outerHTML);
      const frameFile = path.join(DEBUG_DIR, `${safe}_frame${i}_${frameUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-30)}.html`);
      fs.writeFileSync(frameFile, html);
      // Also extract all inputs with their attributes
      const inputs = await frame.evaluate(() => {
        return Array.from(document.querySelectorAll('input, button')).map(el => {
          const e = el as HTMLInputElement;
          return `<${el.tagName.toLowerCase()} id="${e.id}" name="${e.name}" type="${e.type}" placeholder="${e.placeholder}" aria-label="${e.getAttribute('aria-label') ?? ''}" value="${e.value}" />`;
        });
      });
      const inputsFile = path.join(DEBUG_DIR, `${safe}_frame${i}_inputs.txt`);
      fs.writeFileSync(inputsFile, `Frame URL: ${frameUrl}\n\n${inputs.join('\n')}`);
      console.log(`  [Frame ${i}] ${frameUrl.slice(0, 80)}`);
      console.log(`    → inputs saved to ${path.basename(inputsFile)}`);
    } catch (e: any) {
      console.log(`  [Frame ${i}] ${frameUrl.slice(0, 60)} — inaccessible: ${e.message?.slice(0,40)}`);
    }
  }
  console.log(`  Captured ${label}`);
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(buildContextOptions());
  const page = await context.newPage();

  page.on('framenavigated', (frame: any) => {
    if (frame === page.mainFrame()) console.log(`\n[NAV] ${frame.url()}`);
  });

  console.log('\nOpening Beinleumi...\n');
  await page.goto('https://www.fibi.co.il/private');

  const steps = [
    'after_homepage',
    'after_login_modal_open',
    'after_credentials_entered',
    'after_login_submitted',
    'after_otp_screen',
    'after_shlach_clicked',
    'after_otp_entered',
    'after_otp_submitted',
    'dashboard',
  ];

  console.log('=================================================');
  console.log('For EACH step below, do it in the browser THEN:');
  console.log('  echo STEP_NAME > .beinleumi-step.tmp');
  console.log('  (Claude will do this for you if you just say ready)');
  console.log('=================================================\n');

  for (const step of steps) {
    console.log(`\n>>> NEXT STEP: ${step}`);
    console.log(`    Do the action, then tell Claude "ready for ${step}"`);
    const label = await waitForStep();
    console.log(`\nCapturing: ${label}...`);
    await captureState(page, label || step);
  }

  console.log('\n\nAll steps recorded!');
  console.log(`Files saved in: ${DEBUG_DIR}`);
  await browser.close();
}

main().catch(console.error);

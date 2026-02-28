/**
 * Diagnostic: open Beinleumi, let the user log in manually, then capture the
 * account dashboard HTML structure.
 *
 * Trigger capture: create the file .beinleumi-ready.tmp (touch command or any content)
 *   echo 1 > .beinleumi-ready.tmp
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { buildContextOptions } from '../src/helpers/browser';

dotenv.config();

const READY_FILE = path.join(process.cwd(), '.beinleumi-ready.tmp');
const SCREENSHOT_PATH = path.join(process.cwd(), '.beinleumi-debug', 'dashboard.png');

async function waitForReadyFile(): Promise<void> {
  if (fs.existsSync(READY_FILE)) fs.unlinkSync(READY_FILE);
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (fs.existsSync(READY_FILE)) {
        clearInterval(interval);
        fs.unlinkSync(READY_FILE);
        resolve();
      }
    }, 500);
  });
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(buildContextOptions());
  const page = await context.newPage();

  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) console.log(`[NAV] ${frame.url()}`);
  });

  console.log('Opening Beinleumi...\n');
  await page.goto('https://www.fibi.co.il/private');

  console.log('=================================================');
  console.log('CHECKLIST — do ALL of these in the browser first:');
  console.log('  1. Click "כניסה לחשבונך" (login button)');
  console.log('  2. Enter username and password');
  console.log('  3. Click "כניסה" (submit credentials)');
  console.log('  4. Click "שלח" (send OTP to phone)');
  console.log('  5. Enter the OTP code you received');
  console.log('  6. Click the OTP submit button');
  console.log('  7. Wait until you see your ACCOUNT DASHBOARD');
  console.log('');
  console.log('WHILE ON THE DASHBOARD, answer these questions:');
  console.log('  Q1: What URL is in the browser address bar?');
  console.log('  Q2: What is the browser tab title?');
  console.log('  Q3: Right-click your account number → Inspect');
  console.log('      → what is the HTML element? (id, class, tag)');
  console.log('  Q4: Right-click the account balance → Inspect');
  console.log('      → what is the HTML element?');
  console.log('=================================================');
  console.log('');
  console.log('When you are on the dashboard and have the answers:');
  console.log('  → Run: echo 1 > .beinleumi-ready.tmp');
  console.log('  → Claude will capture the page automatically\n');

  await waitForReadyFile();

  const url = page.url();
  const title = await page.title();

  console.log('\n========== DASHBOARD CAPTURED ==========');
  console.log(`URL:   ${url}`);
  console.log(`Title: ${title}`);

  const snapshot = await page.evaluate(() => {
    const results: string[] = [];

    // Dump all elements with id/class that look account-related
    const all = document.querySelectorAll('*');
    const seen = new Set<string>();
    all.forEach(el => {
      const id = el.id;
      const cls = el.className && typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).slice(0, 3).join(' ')
        : '';
      if ((id && id.length > 2) || (cls && cls.length > 2)) {
        const key = `${el.tagName.toLowerCase()}#${id}.${cls}`;
        if (!seen.has(key)) {
          seen.add(key);
          const text = el.textContent?.trim().slice(0, 40) ?? '';
          results.push(`  <${el.tagName.toLowerCase()}> id="${id}" class="${cls}" text="${text}"`);
        }
      }
    });
    return results.slice(0, 80); // first 80 unique elements
  });

  console.log('\nAll named elements on dashboard:');
  snapshot.forEach(s => console.log(s));

  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  console.log(`\nScreenshot: ${SCREENSHOT_PATH}`);
  console.log('========================================\n');

  await browser.close();
}

main().catch(console.error);

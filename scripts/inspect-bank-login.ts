/**
 * Bank Login Inspector
 *
 * Navigates to a bank's login URL, detects all visible input fields,
 * and outputs a ready-to-paste LoginConfig block.
 *
 * Usage:
 *   npx ts-node scripts/inspect-bank-login.ts --url https://start.telebank.co.il/login/
 */
import { chromium } from 'playwright';
import { buildContextOptions } from '../src/helpers/browser';

const SETTLE_MS = 2000;

async function main() {
  const urlFlag = process.argv.indexOf('--url');
  if (urlFlag === -1 || !process.argv[urlFlag + 1]) {
    console.error('Usage: npx ts-node scripts/inspect-bank-login.ts --url <login-url>');
    process.exit(1);
  }
  const loginUrl = process.argv[urlFlag + 1];

  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext(buildContextOptions());
  const page = await context.newPage();

  console.log(`\nNavigating to: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(SETTLE_MS);

  const fields = await detectFormFields(page);
  const submitBtn = await detectSubmitButton(page);

  printReport(loginUrl, fields, submitBtn);
  await browser.close();
}

type DetectedField = {
  selector: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
  name: string;
  labelText: string;
};

async function detectFormFields(page: ReturnType<typeof chromium.launch> extends Promise<infer B> ? never : any): Promise<DetectedField[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=submit]):not([type=button])'))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map(el => {
        const id = el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : el.className.trim() ? `.${el.className.trim().split(' ').join('.')}` : 'input';
        const label = el.labels?.[0]?.textContent?.trim() ?? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ?? '';
        return {
          selector: id,
          type: el.type || 'text',
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          name: el.name || '',
          labelText: label,
        };
      }),
  );
}

async function detectSubmitButton(page: any): Promise<{ selector: string; text: string } | null> {
  return page.evaluate(() => {
    const btn =
      document.querySelector<HTMLElement>('button[type=submit]') ??
      document.querySelector<HTMLElement>('input[type=submit]') ??
      document.querySelector<HTMLElement>('button');
    if (!btn) return null;
    const id = btn.id ? `#${btn.id}` : btn.className.trim() ? `.${btn.className.trim().split(' ').join('.')}` : 'button';
    return { selector: id, text: btn.textContent?.trim() ?? '' };
  });
}

function toCredentialKey(field: DetectedField): string {
  const { type, placeholder, ariaLabel, name, labelText } = field;
  const text = [placeholder, ariaLabel, labelText, name].join(' ').toLowerCase();
  if (type === 'password') return 'password';
  if (text.includes('משתמש') || text.includes('username') || text.includes('user')) return 'username';
  if (text.includes('זהות') || text.includes('ת.ז') || text.includes('national')) return 'id';
  if (text.includes('חשבון') || name === 'num') return 'num';
  if (text.includes('6 ספרות') || text.includes('card')) return 'card6Digits';
  return name || 'unknown';
}

function printReport(loginUrl: string, fields: DetectedField[], submit: { selector: string; text: string } | null) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Login form detected at: ${loginUrl}`);
  console.log(`${'='.repeat(60)}\n`);

  fields.forEach((f, i) => {
    console.log(`  [${i}] ${f.selector}  type=${f.type}`);
    if (f.placeholder) console.log(`      placeholder: "${f.placeholder}"`);
    if (f.ariaLabel)   console.log(`      aria-label:  "${f.ariaLabel}"`);
    if (f.labelText)   console.log(`      label:       "${f.labelText}"`);
    console.log('');
  });

  if (submit) {
    console.log(`Submit: ${submit.selector}  text="${submit.text}"\n`);
  }

  const configFields = fields.map(f => {
    const key = toCredentialKey(f);
    const extras = [
      f.placeholder ? `        { "kind": "placeholder", "value": "${f.placeholder}" }` : null,
      f.ariaLabel   ? `        { "kind": "ariaLabel",   "value": "${f.ariaLabel}" }` : null,
    ].filter(Boolean);
    return [
      `    {`,
      `      "credentialKey": "${key}",`,
      `      "selectors": [`,
      `        { "kind": "css", "value": "${f.selector}" }` + (extras.length ? ',' : ''),
      ...extras.map((e, i) => e + (i < extras.length - 1 ? ',' : '')),
      `      ]`,
      `    }`,
    ].join('\n');
  });

  const submitCandidates = submit
    ? [
        `    { "kind": "css", "value": "${submit.selector}" }`,
        submit.text ? `    { "kind": "ariaLabel", "value": "${submit.text}" }` : null,
      ].filter(Boolean)
    : [];

  console.log('Suggested LoginConfig (copy-paste ready):');
  console.log('{');
  console.log(`  "loginUrl": "${loginUrl}",`);
  console.log('  "fields": [');
  console.log(configFields.join(',\n'));
  console.log('  ],');
  if (submitCandidates.length) {
    console.log('  "submit": [');
    console.log(submitCandidates.join(',\n'));
    console.log('  ],');
  }
  console.log('  "possibleResults": {');
  console.log('    "success": ["<paste-success-url-here>"]');
  console.log('  }');
  console.log('}');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

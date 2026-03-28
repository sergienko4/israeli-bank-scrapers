#!/usr/bin/env bash
# ESLint Canary Verification — asserts every canary file triggers at least 1 error.
set -euo pipefail

CANARY_DIR="src/Scrapers/Pipeline/EslintCanaries"
# Use node to get a cross-platform temp file path (works on Windows + Unix)
TMPFILE="$(node -e "const os=require('os');const p=require('path');console.log(p.join(os.tmpdir(),'canary-verify.json'))")"

echo "🔍 Running Canary Validation..."

# Run ESLint specifically on canaries
npx eslint "$CANARY_DIR"/*.canary.ts --no-ignore --format json 2>/dev/null > "$TMPFILE" || true

node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const dead = [];

  data.forEach(f => {
    const name = f.filePath.replace(/.*[\\\\/]/, '');
    if (f.errorCount === 0) dead.push(name);
  });

  if (dead.length > 0) {
    console.error('\n❌ ARCHITECTURAL FAILURE — Guardrails are inactive for:', dead.join(', '));
    process.exit(1);
  }
  console.log('\n✅ All ' + data.length + ' canaries triggered errors');
" "$TMPFILE"

rm -f "$TMPFILE"

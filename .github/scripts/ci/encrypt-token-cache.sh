#!/usr/bin/env bash
# encrypt-token-cache.sh — encrypt a bank's freshly-refreshed long-term
# OTP JWT before handing it to actions/cache/save. Inverse of
# decrypt-token-cache.sh; uses GPG symmetric AES-256 with MDC integrity.
#
# Why: src/Tests/E2eReal/TokenCache.ts (`buildWriter`) writes the
# freshest JWT to <tmpdir>/<bank>-token.cache when the scraper's
# onAuthFlowComplete callback fires. This script picks that file up
# AFTER the Jest step and prepares an encrypted payload for the cache.
# Plaintext is shredded after encryption so subsequent steps cannot
# leak it via diagnostic uploads.
#
# Usage:
#   CACHE_KEY=<32-byte hex> bash .github/scripts/ci/encrypt-token-cache.sh <Bank>
#
# Inputs:
#   $1            — Bank name (OneZero | Pepper | PayBox).
#   $CACHE_KEY    — 32-byte hex symmetric passphrase (repo secret
#                   TOKEN_CACHE_KEY). When unset OR empty, exits 0
#                   without action.
#
# Output:
#   /tmp/tokens-encrypted/<bank-lower>-token.cache.gpg  — ciphertext.
#   /tmp/tokens-encrypted/.keep                          — sentinel so
#     actions/cache/save never sees an empty directory (per
#     rubber-duck #7).
#
# Exit codes:
#   0  always (encrypt failures are logged as ::warning but never fail
#      CI — fresh OTP flow on the next run remains a valid fallback).

set -euo pipefail

BANK_TITLE="${1:?usage: encrypt-token-cache.sh <Bank>}"
BANK_LOWER=$(printf '%s' "$BANK_TITLE" | tr '[:upper:]' '[:lower:]')
PLAIN_FILE="/tmp/${BANK_LOWER}-token.cache"
ENC_DIR="/tmp/tokens-encrypted"
ENC_FILE="${ENC_DIR}/${BANK_LOWER}-token.cache.gpg"

mkdir -p "$ENC_DIR"
# Sentinel keeps actions/cache/save happy on cold runs where nothing
# got written (avoids "Path does not exist" cache failure).
touch "${ENC_DIR}/.keep"

if [ ! -f "$PLAIN_FILE" ]; then
  echo "::notice title=TokenCache::no plaintext token to encrypt for ${BANK_TITLE} (auth-flow callback did not fire)"
  exit 0
fi

if [ -z "${CACHE_KEY:-}" ]; then
  echo "::warning title=TokenCache::TOKEN_CACHE_KEY not set — skipping encrypt for ${BANK_TITLE} (token will not persist across runs)"
  shred -fu "$PLAIN_FILE" 2>/dev/null || rm -f "$PLAIN_FILE"
  exit 0
fi

if ! gpg --batch --quiet --yes --pinentry-mode loopback \
        --passphrase-fd 3 \
        --symmetric --cipher-algo AES256 --s2k-mode 3 \
        --s2k-count 65011712 --s2k-digest-algo SHA512 \
        --output "$ENC_FILE" \
        "$PLAIN_FILE" 3<<<"$CACHE_KEY"; then
  echo "::warning title=TokenCache::encrypt failed for ${BANK_TITLE} — token will not persist across runs"
  shred -fu "$PLAIN_FILE" 2>/dev/null || rm -f "$PLAIN_FILE"
  exit 0
fi

chmod 600 "$ENC_FILE"
ENC_LEN=$(wc -c <"$ENC_FILE" | tr -d ' ')
echo "::notice title=TokenCache::encrypted ${BANK_TITLE} (ciphertext length=${ENC_LEN})"

# Scrub plaintext from /tmp so artifact-upload steps cannot leak it.
shred -fu "$PLAIN_FILE" 2>/dev/null || rm -f "$PLAIN_FILE"

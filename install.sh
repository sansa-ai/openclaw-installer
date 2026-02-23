#!/bin/sh
# Sansa for OpenClaw — one-line installer
#
# Usage:
#   curl -fsSL https://app.sansaml.com/openclaw/install.sh | sh -s -- YOUR_API_KEY
#
# What this does:
#   1. Checks that Node.js (>= 20) is available (OpenClaw already requires it)
#   2. Downloads the bundled installer (install.mjs) to a temp file
#   3. Runs it with --api-key
#   4. Cleans up
#
set -e

# ── Where the compiled installer lives ────────────────────────────────────
INSTALLER_URL="${SANSA_INSTALLER_URL:-https://app.sansaml.com/openclaw/install.mjs}"

# ── Colors (disabled when not a tty) ─────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' RED='' BOLD='' RESET=''
fi

info()  { printf "${GREEN}%s${RESET}\n" "$*"; }
error() { printf "${RED}error:${RESET} %s\n" "$*" >&2; }
bold()  { printf "${BOLD}%s${RESET}" "$*"; }

# ── Validate API key ─────────────────────────────────────────────────────
API_KEY="${1:-}"
if [ -z "$API_KEY" ]; then
  error "API key required."
  echo ""
  echo "Usage:"
  echo "  curl -fsSL https://app.sansaml.com/openclaw/install.sh | sh -s -- YOUR_API_KEY"
  echo ""
  exit 1
fi

# ── Check for Node.js ────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found."
  echo "  OpenClaw requires Node 20+. Install it first:"
  echo "  https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  error "Node.js v${NODE_MAJOR} is too old. OpenClaw requires Node 20+."
  echo "  https://nodejs.org"
  exit 1
fi

# ── Download installer to temp file ──────────────────────────────────────
TMPFILE=$(mktemp /tmp/sansa-install-XXXXXX.mjs)
cleanup() { rm -f "$TMPFILE"; }
trap cleanup EXIT

if [ -n "${SANSA_INSTALLER_LOCAL:-}" ]; then
  cp "$SANSA_INSTALLER_LOCAL" "$TMPFILE"
else
  info "Downloading Sansa installer…"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$INSTALLER_URL" -o "$TMPFILE"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMPFILE" "$INSTALLER_URL"
  else
    error "Neither curl nor wget found. Install one and try again."
    exit 1
  fi
fi

# ── Run it ───────────────────────────────────────────────────────────────
node "$TMPFILE" --api-key "$API_KEY"

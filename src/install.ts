/**
 * Sansa installer for OpenClaw.
 *
 * Bundled into a single `dist/install.mjs` via esbuild, then hosted at
 * `app.sansaml.com/openclaw/install.mjs`. Users run the companion shell
 * script which downloads and executes this file:
 *
 * ```bash
 * curl -fsSL https://app.sansaml.com/openclaw/install.sh | sh -s -- YOUR_API_KEY
 * ```
 *
 * Steps:
 *   1. Patches `~/.openclaw/openclaw.json` — adds sansa-ai provider, sets default model
 *   2. Installs a gateway startup hook — logs a Sansa banner on every gateway start
 *   3. Creates `~/.openclaw/sansa.json` — Sansa-specific config (savings pricing)
 *   4. Drops savings-tracker script — standalone Node script for savings reports
 *   5. Optionally updates HEARTBEAT.md so the agent reports savings each session
 */

import fs from "node:fs";
import readline from "node:readline";

import { patchOpenClawConfig } from "./config-patch.js";
import { HOOK_MD, HOOK_HANDLER_JS, SAVINGS_TRACKER_MJS } from "./templates.js";
import {
  CONFIG_PATH,
  SANSA_CONFIG_PATH,
  SANSA_HOOK_DIR,
  SANSA_SCRIPTS_DIR,
  BASELINE_PRICING,
  SANSA_PRICING,
  type SansaConfig,
} from "./types.js";
import { writeJson, readJson } from "./config-patch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Prompt for a single line of input on stdin.
 *
 * Returns empty string when stdin is not a TTY (piped execution).
 */
async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** A single item in an {@link arrowMenu}. */
type MenuItem = { label: string; hint?: string };

/**
 * Renders an interactive arrow-key selection menu on stdout.
 *
 * Uses raw stdin mode so arrow keys and Enter are captured directly.
 * The cursor is hidden while the menu is active and restored on exit.
 * Falls back to returning index `0` silently when stdin is not a TTY.
 *
 * @param items - Menu items to display.
 * @param ansi  - ANSI escape codes for formatting.
 * @returns The 0-based index of the selected item.
 */
async function arrowMenu(
  items: MenuItem[],
  ansi: { B: string; D: string; G: string; R: string },
): Promise<number> {
  if (!process.stdin.isTTY) return 0;

  const { B, D, G, R } = ansi;
  let cursor = 0;

  const HIDE_CURSOR = "\x1b[?25l";
  const SHOW_CURSOR = "\x1b[?25h";

  const renderLines = (): void => {
    for (const [i, item] of items.entries()) {
      const active    = i === cursor;
      const indicator = active ? `${G}›${R}` : " ";
      const label     = active ? `${B}${item.label}${R}` : item.label;
      const hint      = item.hint ? `  ${D}${item.hint}${R}` : "";
      process.stdout.write(`    ${indicator}  ${label}${hint}\n`);
    }
  };

  process.stdout.write(`\n${HIDE_CURSOR}`);
  renderLines();

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const done = (idx: number): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onKey);
      process.stdout.write(SHOW_CURSOR + "\n");
      resolve(idx);
    };

    const onKey = (key: string): void => {
      if (key === "\x1b[A") {                     // ↑
        cursor = (cursor - 1 + items.length) % items.length;
      } else if (key === "\x1b[B") {              // ↓
        cursor = (cursor + 1) % items.length;
      } else if (key === "\r" || key === "\n") {  // Enter
        done(cursor);
        return;
      } else if (key === "\x03") {                // Ctrl-C
        process.stdout.write(SHOW_CURSOR + "\n");
        process.exit(130);
      } else {
        return;
      }

      // Redraw in-place: jump back up and overwrite.
      process.stdout.write(`\x1b[${items.length}A`);
      renderLines();
    };

    process.stdin.on("data", onKey);
  });
}

// ---------------------------------------------------------------------------
// Step 2 — gateway startup hook
// ---------------------------------------------------------------------------

/**
 * Write the Sansa startup hook into `~/.openclaw/hooks/sansa-startup/`.
 */
function installStartupHook(): void {
  fs.mkdirSync(SANSA_HOOK_DIR, { recursive: true });
  fs.writeFileSync(`${SANSA_HOOK_DIR}/HOOK.md`, HOOK_MD, "utf-8");
  fs.writeFileSync(`${SANSA_HOOK_DIR}/handler.js`, HOOK_HANDLER_JS, "utf-8");
}

// ---------------------------------------------------------------------------
// Step 3 — sansa.json
// ---------------------------------------------------------------------------

/**
 * Create the Sansa config file if it doesn't already exist.
 */
function createSansaConfig(): void {
  if (readJson(SANSA_CONFIG_PATH)) return;

  const config: SansaConfig = {
    savings_notifications: true,
    interval_hours: 24,
    baseline: BASELINE_PRICING,
    sansa: SANSA_PRICING,
  };

  writeJson(SANSA_CONFIG_PATH, config);
}

// ---------------------------------------------------------------------------
// Step 4 — savings tracker
// ---------------------------------------------------------------------------

/**
 * Write the self-contained savings-tracker script to
 * `~/.openclaw/sansa/savings-tracker.mjs`.
 */
function installSavingsTracker(): void {
  fs.mkdirSync(SANSA_SCRIPTS_DIR, { recursive: true });
  fs.writeFileSync(`${SANSA_SCRIPTS_DIR}/savings-tracker.mjs`, SAVINGS_TRACKER_MJS, { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// Step 5 — heartbeat
// ---------------------------------------------------------------------------

/**
 * Returns the configured workspace path from `openclaw.json`, falling back
 * to `~/.openclaw/workspace`.
 */
function getWorkspacePath(): string {
  const cfg = readJson(CONFIG_PATH) ?? {};
  const agents = cfg["agents"] as Record<string, unknown> | undefined;
  const defaults = agents?.["defaults"] as Record<string, unknown> | undefined;
  const workspace = defaults?.["workspace"];
  if (typeof workspace === "string" && workspace) return workspace;
  return `${CONFIG_PATH.replace("/openclaw.json", "")}/workspace`;
}

/**
 * Appends a Sansa savings blurb to `HEARTBEAT.md` in the agent workspace so
 * the agent reports token savings on every session.
 *
 * Skips silently if the blurb is already present.
 */
function updateHeartbeat(): void {
  const workspacePath = getWorkspacePath();
  const heartbeatPath = `${workspacePath}/HEARTBEAT.md`;

  const blurb = [
    "",
    "## Sansa",
    "",
    "Run `node ~/.openclaw/sansa/savings-tracker.mjs` and share a brief savings summary with the user.",
    "",
  ].join("\n");

  if (fs.existsSync(heartbeatPath)) {
    const existing = fs.readFileSync(heartbeatPath, "utf-8");
    if (existing.includes("savings-tracker.mjs")) return;
    fs.appendFileSync(heartbeatPath, blurb, "utf-8");
  } else {
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(heartbeatPath, blurb.trimStart(), "utf-8");
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const G = "\x1b[32m"; // green
  const B = "\x1b[1m";  // bold
  const D = "\x1b[2m";  // dim
  const C = "\x1b[36m"; // cyan
  const R = "\x1b[0m";  // reset

  const ok = (label: string): void => {
    process.stdout.write(`  ${G}✓${R}  ${label}\n`);
  };

  process.stdout.write(`\n${B}  Sansa for OpenClaw${R}\n\n`);

  // ── Collect all input upfront ──────────────────────────────────────────────

  let apiKey = "";
  const keyIdx = process.argv.indexOf("--api-key");
  if (keyIdx !== -1 && process.argv[keyIdx + 1]) {
    apiKey = process.argv[keyIdx + 1].trim();
  }
  if (!apiKey) {
    apiKey = await prompt(`  ${D}API key:${R} `);
  }
  if (!apiKey) {
    process.stderr.write(`\n  Error: API key is required.\n\n`);
    process.exit(1);
  }

  process.stdout.write(`\n  ${D}Get savings updates in your heartbeat?${R}`);
  const heartbeatChoice = await arrowMenu(
    [{ label: "Yes" }, { label: "No" }],
    { B, D, G, R },
  );
  const addHeartbeat = heartbeatChoice === 0;

  process.stdout.write("\n");

  // ── Run steps ─────────────────────────────────────────────────────────────

  patchOpenClawConfig(apiKey);
  ok("Provider configured");

  installStartupHook();
  ok("Startup hook installed");

  createSansaConfig();
  ok("Savings config ready");

  installSavingsTracker();
  ok("Savings tracker installed");

  if (addHeartbeat) {
    updateHeartbeat();
    ok("Heartbeat updated");
  }

  // ── Footer ─────────────────────────────────────────────────────────────────

  process.stdout.write(`\n  Restart your gateway:\n\n    ${B}${C}openclaw gateway restart${R}\n\n`);
}

main().catch((err: unknown) => {
  console.error("Install failed:", err);
  process.exit(1);
});

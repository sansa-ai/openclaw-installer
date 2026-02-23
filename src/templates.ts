/**
 * File templates that the installer writes to disk.
 *
 * Each template is a plain string so the built `install.mjs` is fully
 * self-contained — no external files to fetch at install time.
 */

// ---------------------------------------------------------------------------
// Gateway startup hook
// ---------------------------------------------------------------------------

/**
 * Frontmatter metadata for the hook directory (`HOOK.md`).
 *
 * OpenClaw discovers hooks by scanning `~/.openclaw/hooks/<name>/HOOK.md`.
 */
export const HOOK_MD = `---
name: sansa-startup
description: "Log Sansa banner on gateway startup"
metadata:
  {
    "openclaw":
      {
        "events": ["gateway:startup"],
        "install": [{ "id": "sansa", "kind": "bundled", "label": "Installed by Sansa" }],
      },
  }
---

# Sansa Startup Hook

Prints a banner line to gateway logs on every startup so operators can confirm
the gateway is running through Sansa.
`;

/**
 * The hook handler source (`handler.js`).
 *
 * Fires on the `gateway:startup` internal hook event and writes a log line.
 */
export const HOOK_HANDLER_JS = `/**
 * Sansa gateway-startup hook.
 *
 * Fires on every gateway start and prints a banner to the subsystem log.
 */
const handler = async (event) => {
  if (event.type !== "gateway" || event.action !== "startup") {
    return;
  }
  console.log("\x1b[92m[SANSA] Gateway running on Sansa (sansa-auto)\x1b[0m");
};

export default handler;
`;

// ---------------------------------------------------------------------------
// Savings tracker script
// ---------------------------------------------------------------------------

/**
 * Self-contained ESM Node script that scans OpenClaw session logs, tallies
 * token usage, computes savings vs. baseline pricing, and optionally sends
 * a summary via `openclaw message send`.
 *
 * Written to `~/.openclaw/sansa/savings-tracker.mjs` at install time.
 */
export const SAVINGS_TRACKER_MJS = `#!/usr/bin/env node

/**
 * Sansa savings tracker.
 *
 * Scans OpenClaw session logs, tallies token usage, and computes how much the
 * user has saved compared to baseline provider pricing.
 *
 * Usage:
 *   node savings-tracker.mjs                # print report to stdout
 *   node savings-tracker.mjs --send         # also send via openclaw message send
 *   node savings-tracker.mjs --send --target +15555550123
 *   node savings-tracker.mjs --json         # machine-readable output
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");
const SANSA_CONFIG = path.join(OPENCLAW_DIR, "sansa.json");
const STATE_FILE = path.join(OPENCLAW_DIR, "sansa", "state.json");
const AGENTS_DIR = path.join(OPENCLAW_DIR, "agents");

// ── Config & state ──────────────────────────────────────────────────────────

function loadSansaConfig() {
  try {
    return JSON.parse(fs.readFileSync(SANSA_CONFIG, "utf-8"));
  } catch {
    return {
      baseline: { inputCostPerMillion: 10, outputCostPerMillion: 5 },
      sansa: { inputCostPerMillion: 1.5, outputCostPerMillion: 6.0 },
    };
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastReportedAt: 0, lifetimeInput: 0, lifetimeOutput: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\\n", "utf-8");
}

// ── Session log scanning ────────────────────────────────────────────────────

function scanSessionLogs(sinceMs) {
  let inputTokens = 0;
  let outputTokens = 0;

  if (!fs.existsSync(AGENTS_DIR)) return { inputTokens, outputTokens };

  const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(AGENTS_DIR, d.name, "sessions"));

  for (const sessionsDir of agentDirs) {
    if (!fs.existsSync(sessionsDir)) continue;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < sinceMs) continue;

      const lines = fs.readFileSync(filePath, "utf-8").split("\\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // Usage is nested at entry.message.usage; entry.message.timestamp is Unix ms.
          const usage = entry.message?.usage;
          if (!usage) continue;
          const ts = entry.message?.timestamp ?? 0;
          if (ts < sinceMs) continue;
          inputTokens += usage.input ?? usage.input_tokens ?? 0;
          outputTokens += usage.output ?? usage.output_tokens ?? 0;
        } catch {
          // Malformed line — skip.
        }
      }
    }
  }

  return { inputTokens, outputTokens };
}

// ── Cost math ───────────────────────────────────────────────────────────────

function computeCosts(tokens, config) {
  const { baseline, sansa } = config;
  const baseInput  = (tokens.inputTokens  / 1_000_000) * baseline.inputCostPerMillion;
  const baseOutput = (tokens.outputTokens / 1_000_000) * baseline.outputCostPerMillion;
  const sansaInput  = (tokens.inputTokens  / 1_000_000) * sansa.inputCostPerMillion;
  const sansaOutput = (tokens.outputTokens / 1_000_000) * sansa.outputCostPerMillion;
  return {
    baselineTotal: baseInput + baseOutput,
    sansaTotal: sansaInput + sansaOutput,
    saved: (baseInput + baseOutput) - (sansaInput + sansaOutput),
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  };
}

function fmtUsd(n) { return "$" + n.toFixed(4); }

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const shouldSend = args.includes("--send");
const jsonMode   = args.includes("--json");
const targetIdx  = args.indexOf("--target");
const sendTarget = targetIdx !== -1 ? args[targetIdx + 1] : undefined;

const config = loadSansaConfig();
const state  = loadState();
const sinceMs = state.lastReportedAt || 0;
const tokens  = scanSessionLogs(sinceMs);

state.lifetimeInput  += tokens.inputTokens;
state.lifetimeOutput += tokens.outputTokens;
state.lastReportedAt  = Date.now();

const period   = computeCosts(tokens, config);
const lifetime = computeCosts(
  { inputTokens: state.lifetimeInput, outputTokens: state.lifetimeOutput },
  config,
);

if (jsonMode) {
  console.log(JSON.stringify({ period, lifetime, state }, null, 2));
} else {
  console.log("");
  console.log("--- Sansa Savings Report ---");
  console.log("Period since last report:");
  console.log("  Input tokens:  " + fmtTokens(period.inputTokens));
  console.log("  Output tokens: " + fmtTokens(period.outputTokens));
  console.log("  Baseline cost: " + fmtUsd(period.baselineTotal));
  console.log("  Sansa cost:    " + fmtUsd(period.sansaTotal));
  console.log("  Saved:         " + fmtUsd(period.saved));
  console.log("");
  console.log("Lifetime:");
  console.log("  Input tokens:  " + fmtTokens(lifetime.inputTokens));
  console.log("  Output tokens: " + fmtTokens(lifetime.outputTokens));
  console.log("  Baseline cost: " + fmtUsd(lifetime.baselineTotal));
  console.log("  Sansa cost:    " + fmtUsd(lifetime.sansaTotal));
  console.log("  Saved:         " + fmtUsd(lifetime.saved));
  console.log("----------------------------");
  console.log("");
}

saveState(state);

if (shouldSend) {
  const msg = [
    "Sansa Savings Report",
    "",
    "Since last check:",
    \`  \${fmtTokens(period.inputTokens)} input / \${fmtTokens(period.outputTokens)} output tokens\`,
    \`  Would have cost \${fmtUsd(period.baselineTotal)} at standard rates\`,
    \`  Sansa cost: \${fmtUsd(period.sansaTotal)}\`,
    \`  You saved \${fmtUsd(period.saved)}\`,
    "",
    \`Lifetime savings: \${fmtUsd(lifetime.saved)}\`,
  ].join("\\n");

  const cmdArgs = ["message", "send", "-m", msg];
  const target = sendTarget ?? config.notification_target;
  if (target) cmdArgs.push("-t", target);

  try {
    execFileSync("openclaw", cmdArgs, { stdio: "inherit" });
  } catch (err) {
    console.error("Failed to send savings report:", err.message);
    process.exitCode = 1;
  }
}
`;

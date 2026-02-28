/**
 * Shared types and constants for the Sansa OpenClaw installer.
 */

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Per-million-token cost structure.
 */
export type TokenPricing = {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
};

/**
 * Baseline "big-provider" pricing the user would pay without Sansa (USD / 1M tokens).
 *
 * Represents typical Anthropic / OpenAI flagship rates.
 */
export const BASELINE_PRICING: TokenPricing = {
  inputCostPerMillion: 10,
  outputCostPerMillion: 5,
};

/**
 * Sansa system pricing (USD / 1M tokens).
 */
export const SANSA_PRICING: TokenPricing = {
  inputCostPerMillion: 1.5,
  outputCostPerMillion: 6.0,
};

// ---------------------------------------------------------------------------
// OpenClaw config shapes (just the slices we touch)
// ---------------------------------------------------------------------------

/**
 * Minimal model cost block expected by OpenClaw.
 */
export type ModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/**
 * Single model entry inside a provider's `models` array.
 */
export type ProviderModelEntry = {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
};

/**
 * Provider block we merge into `models.providers`.
 */
export type ProviderBlock = {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: ProviderModelEntry[];
};

/**
 * Loosely-typed superset of openclaw.json — we only access known paths and
 * pass the rest through untouched via deep-merge.
 */
export type OpenClawConfig = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Sansa config (sansa.json)
// ---------------------------------------------------------------------------

/**
 * Shape of `~/.openclaw/sansa.json`.
 */
export type SansaConfig = {
  savings_notifications: boolean;
  interval_hours: number;
  baseline: TokenPricing;
  sansa: TokenPricing;
};

// ---------------------------------------------------------------------------
// Savings state (state.json)
// ---------------------------------------------------------------------------

/**
 * Persistent state for the savings tracker, stored at
 * `~/.openclaw/sansa/state.json`.
 */
export type SavingsState = {
  lastReportedAt: number;
  lifetimeInput: number;
  lifetimeOutput: number;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

import os from "node:os";
import path from "node:path";

/** Root OpenClaw state directory. */
export const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");

/** Main OpenClaw config file. */
export const CONFIG_PATH = path.join(OPENCLAW_DIR, "openclaw.json");

/** Sansa-specific config file. */
export const SANSA_CONFIG_PATH = path.join(OPENCLAW_DIR, "sansa.json");

/** OpenClaw managed-hooks directory. */
export const HOOKS_DIR = path.join(OPENCLAW_DIR, "hooks");

/** Directory for the Sansa startup hook. */
export const SANSA_HOOK_DIR = path.join(HOOKS_DIR, "sansa-startup");

/** Directory for Sansa scripts and state. */
export const SANSA_SCRIPTS_DIR = path.join(OPENCLAW_DIR, "sansa");

/** Savings tracker state file. */
export const SANSA_STATE_PATH = path.join(SANSA_SCRIPTS_DIR, "state.json");

/** OpenClaw agents directory (contains session logs). */
export const AGENTS_DIR = path.join(OPENCLAW_DIR, "agents");

// ---------------------------------------------------------------------------
// Provider constants
// ---------------------------------------------------------------------------

/** Base URL for the Sansa API. */
export const SANSA_BASE_URL = "https://api.sansaml.com/v1";

/** The sansa-auto model definition merged into openclaw.json. */
export const SANSA_MODEL_ENTRY: ProviderModelEntry = {
  id: "sansa-auto",
  name: "sansa-auto (Custom Provider)",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1.5, output: 6.0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 32768,
};

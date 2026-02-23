/**
 * Reads, deep-merges, and writes `~/.openclaw/openclaw.json` with the
 * Sansa provider and default-model configuration.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_PATH, SANSA_MODEL_ENTRY } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSON file. Returns `null` when the file is missing or unparseable.
 */
export function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Write a JSON file, creating parent directories as needed.
 */
export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Recursively merge {@link source} into {@link target}.
 *
 * Arrays and non-plain-object values from `source` overwrite `target`.
 * Plain objects are merged key-by-key.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    const existing = out[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMerge(
        existing as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      out[key] = val;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Merge Sansa provider + default-model config into the user's openclaw.json.
 *
 * Backs up the original file before writing.
 *
 * @param apiKey - The user's Sansa API key.
 */
export function patchOpenClawConfig(apiKey: string): void {
  const existing = readJson(CONFIG_PATH) ?? {};

  const sansaPatch: Record<string, unknown> = {
    models: {
      mode: "merge",
      providers: {
        "sansa-ai": {
          baseUrl: "https://api.sansaml.com/v1",
          apiKey,
          api: "openai-completions",
          models: [SANSA_MODEL_ENTRY],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: "sansa-ai/sansa-auto" },
        models: { "sansa-ai/sansa-auto": { alias: "Sansa" } },
      },
    },
  };

  const merged = deepMerge(existing, sansaPatch);

  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak.${Date.now()}`);
  }

  writeJson(CONFIG_PATH, merged);
}

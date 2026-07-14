/**
 * Configuration loading and validation.
 *
 * toolint reads an optional `toolint.config.json`:
 *
 *   {
 *     "rules": {
 *       "enum-large": "off",
 *       "too-many-params": { "severity": "error", "options": { "max": 6 } }
 *     },
 *     "ignoreTools": ["legacy_*"]
 *   }
 *
 * Validation is strict on purpose: an unknown rule id or option name is a
 * hard error, because a silently ignored typo would un-disable a rule.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ResolvedConfig, RuleSetting, Severity } from "./types.js";
import { RULES_BY_ID } from "./rules/index.js";
import { isRecord } from "./walk.js";

/** The config file name discovered by upward search. */
export const CONFIG_FILENAME = "toolint.config.json";

/** Raised for unreadable or invalid configuration (CLI exit code 2). */
export class ToolintConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolintConfigError";
  }
}

const SEVERITY_VALUES = new Set(["off", "info", "warn", "error"]);

/** Validate and resolve a parsed config document. */
export function resolveConfig(raw: unknown, source = CONFIG_FILENAME): ResolvedConfig {
  if (!isRecord(raw)) {
    throw new ToolintConfigError(`${source}: config must be a JSON object`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "rules" && key !== "ignoreTools" && key !== "$schema") {
      throw new ToolintConfigError(`${source}: unknown top-level key "${key}" (expected "rules" or "ignoreTools")`);
    }
  }

  const rules = new Map<string, RuleSetting>();
  const rawRules = raw["rules"];
  if (rawRules !== undefined) {
    if (!isRecord(rawRules)) {
      throw new ToolintConfigError(`${source}: "rules" must be an object mapping rule ids to settings`);
    }
    for (const [id, setting] of Object.entries(rawRules)) {
      const rule = RULES_BY_ID.get(id);
      if (rule === undefined) {
        throw new ToolintConfigError(`${source}: unknown rule id "${id}" (run \`toolint --rules\` for the list)`);
      }
      rules.set(id, resolveSetting(id, setting, rule.optionDefaults ?? {}, source));
    }
  }

  const ignoreTools: string[] = [];
  const rawIgnore = raw["ignoreTools"];
  if (rawIgnore !== undefined) {
    if (!Array.isArray(rawIgnore) || rawIgnore.some((entry) => typeof entry !== "string")) {
      throw new ToolintConfigError(`${source}: "ignoreTools" must be an array of name patterns`);
    }
    ignoreTools.push(...(rawIgnore as string[]));
  }

  return { rules, ignoreTools };
}

/** Resolve one rule entry: either a bare severity string or an object. */
function resolveSetting(
  id: string,
  setting: unknown,
  optionDefaults: Record<string, number>,
  source: string,
): RuleSetting {
  if (typeof setting === "string") {
    assertSeverity(id, setting, source);
    return { severity: setting as Severity | "off", options: {} };
  }
  if (!isRecord(setting)) {
    throw new ToolintConfigError(`${source}: rule "${id}" must be a severity string or an object`);
  }
  const severityRaw = setting["severity"];
  let severity: Severity | "off" | undefined;
  if (severityRaw !== undefined) {
    if (typeof severityRaw !== "string") {
      throw new ToolintConfigError(`${source}: rule "${id}": "severity" must be a string`);
    }
    assertSeverity(id, severityRaw, source);
    severity = severityRaw as Severity | "off";
  }
  const options: Record<string, number> = {};
  const optionsRaw = setting["options"];
  if (optionsRaw !== undefined) {
    if (!isRecord(optionsRaw)) {
      throw new ToolintConfigError(`${source}: rule "${id}": "options" must be an object`);
    }
    for (const [key, value] of Object.entries(optionsRaw)) {
      if (!(key in optionDefaults)) {
        const known = Object.keys(optionDefaults);
        const expected = known.length > 0 ? `expected one of: ${known.join(", ")}` : "this rule has no options";
        throw new ToolintConfigError(`${source}: rule "${id}": unknown option "${key}" (${expected})`);
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new ToolintConfigError(`${source}: rule "${id}": option "${key}" must be a non-negative number`);
      }
      options[key] = value;
    }
  }
  const fallback = RULES_BY_ID.get(id)?.defaultSeverity ?? "warn";
  return { severity: severity ?? fallback, options };
}

function assertSeverity(id: string, value: string, source: string): void {
  if (!SEVERITY_VALUES.has(value)) {
    throw new ToolintConfigError(
      `${source}: rule "${id}": invalid severity "${value}" (expected off, info, warn, or error)`,
    );
  }
}

/** Load and resolve a config file from disk. */
export function loadConfigFile(path: string): ResolvedConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ToolintConfigError(`cannot read config ${path}: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ToolintConfigError(`${path}: invalid JSON (${detail})`);
  }
  return resolveConfig(parsed, path);
}

/** Search for `toolint.config.json` from `startDir` up to the filesystem root. */
export function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

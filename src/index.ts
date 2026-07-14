/**
 * toolint — a linter for MCP tool JSON Schemas.
 *
 * Public programmatic API:
 *
 *   import { lintTools, parseToolsJson, resolveConfig, ALL_RULES } from "toolint";
 *
 *   const tools = parseToolsJson(jsonText, "my-server.json");
 *   const { findings, summary } = lintTools(tools);
 */
export { lintTools, defaultConfig, displayName, summarize } from "./engine.js";
export { parseToolsJson, ToolintParseError } from "./parse.js";
export {
  resolveConfig,
  loadConfigFile,
  findConfigFile,
  ToolintConfigError,
  CONFIG_FILENAME,
} from "./config.js";
export { formatPretty, formatCompact, formatJson, summaryLine } from "./format.js";
export type { FileResult } from "./format.js";
export { ALL_RULES, RULES_BY_ID, namingRules, descriptionRules, schemaRules, enumRules } from "./rules/index.js";
export { walkSchema, hasTypeInformation, isRecord, escapePointer } from "./walk.js";
export type { SchemaNode } from "./walk.js";
export {
  splitWords,
  normalizeName,
  isActionVerb,
  isGenericName,
  isAmbiguousParam,
  isNegatedBoolean,
  isPlaceholderText,
  isVagueEnumValue,
  editDistance,
  globMatch,
} from "./text.js";
export { VERSION } from "./version.js";
export type {
  Severity,
  RuleCategory,
  ToolDef,
  RuleOptions,
  RawFinding,
  Finding,
  ToolContext,
  ToolsetContext,
  Rule,
  RuleSetting,
  ResolvedConfig,
  LintSummary,
  LintResult,
} from "./types.js";

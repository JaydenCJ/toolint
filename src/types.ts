/**
 * Shared types for toolint: tool definitions, findings, rules, and config.
 *
 * toolint deliberately does NOT model full JSON Schema — it inspects the
 * subset that matters for model usability (names, descriptions, properties,
 * enums, defaults, required lists, combinators) and treats everything else
 * as opaque data.
 */

/** Severity of a finding. `error` fails the lint (exit code 1). */
export type Severity = "error" | "warn" | "info";

/** Severity levels ordered from least to most severe. */
export const SEVERITIES: readonly Severity[] = ["info", "warn", "error"];

/** The rule taxonomy; every rule belongs to exactly one category. */
export type RuleCategory = "naming" | "description" | "schema" | "enum";

/**
 * A tool definition as harvested from an MCP `tools/list` result.
 * All fields are `unknown` on purpose: toolint lints malformed input
 * instead of rejecting it.
 */
export interface ToolDef {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  [key: string]: unknown;
}

/** Numeric knobs a rule exposes (e.g. `max` for too-many-params). */
export type RuleOptions = Record<string, number>;

/** A finding before the engine attaches rule id, severity, and tool name. */
export interface RawFinding {
  /** JSON-pointer-like location inside the tool, e.g. `/inputSchema/properties/mode/enum`. */
  path: string;
  /** What is wrong, in one sentence. */
  message: string;
  /** Actionable fix suggestion, shown indented under the message. */
  hint?: string;
  /** For toolset-scoped rules: which tool the finding belongs to. */
  toolIndex?: number;
}

/** A fully resolved lint finding. */
export interface Finding {
  rule: string;
  category: RuleCategory;
  severity: Severity;
  /** Display name of the tool (`<tool #N>` when the name is unusable). */
  tool: string;
  /** Zero-based index of the tool in the linted set. */
  toolIndex: number;
  path: string;
  message: string;
  hint?: string;
}

/** Context handed to a tool-scoped rule check. */
export interface ToolContext {
  tool: ToolDef;
  /** Display name (never empty). */
  name: string;
  index: number;
  options: RuleOptions;
}

/** Context handed to a toolset-scoped rule check. */
export interface ToolsetContext {
  tools: ToolDef[];
  /** Display names aligned with `tools`. */
  names: string[];
  options: RuleOptions;
}

/** A lint rule. Exactly one of checkTool / checkToolset is implemented. */
export interface Rule {
  id: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  /** One-line human summary, shown by `toolint --rules` and in docs. */
  summary: string;
  scope: "tool" | "toolset";
  /** Default values for numeric options, if the rule has any. */
  optionDefaults?: RuleOptions;
  checkTool?(ctx: ToolContext): RawFinding[];
  checkToolset?(ctx: ToolsetContext): RawFinding[];
}

/** Per-rule setting after config resolution. */
export interface RuleSetting {
  severity: Severity | "off";
  options: RuleOptions;
}

/** A validated, ready-to-use configuration. */
export interface ResolvedConfig {
  rules: Map<string, RuleSetting>;
  /** Tool-name glob patterns (only `*` wildcards) to skip entirely. */
  ignoreTools: string[];
}

/** Counters attached to every lint result. */
export interface LintSummary {
  errors: number;
  warnings: number;
  infos: number;
  /** Number of tools linted (after ignores). */
  tools: number;
  /** Number of tools with at least one finding. */
  flaggedTools: number;
}

/** The result of linting one set of tools. */
export interface LintResult {
  findings: Finding[];
  summary: LintSummary;
}

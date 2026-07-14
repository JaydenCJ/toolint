/**
 * The lint engine: resolves per-rule settings, runs every enabled rule
 * over a toolset, attaches severities, and returns findings in a stable
 * order (tool, then path, then rule id) with a summary.
 */
import type {
  Finding,
  LintResult,
  LintSummary,
  ResolvedConfig,
  Rule,
  RuleOptions,
  Severity,
  ToolDef,
} from "./types.js";
import { ALL_RULES } from "./rules/index.js";
import { globMatch } from "./text.js";

/** An empty configuration: every rule at its default severity. */
export function defaultConfig(): ResolvedConfig {
  return { rules: new Map(), ignoreTools: [] };
}

/** Display name for a tool: its name, or a positional fallback. */
export function displayName(tool: ToolDef, index: number): string {
  const { name } = tool;
  if (typeof name === "string" && name.trim().length > 0) return name;
  return `<tool #${index + 1}>`;
}

/** Effective severity for a rule under a config ("off" disables it). */
function severityFor(rule: Rule, config: ResolvedConfig): Severity | "off" {
  return config.rules.get(rule.id)?.severity ?? rule.defaultSeverity;
}

/** Effective options: rule defaults overlaid with config overrides. */
function optionsFor(rule: Rule, config: ResolvedConfig): RuleOptions {
  return { ...(rule.optionDefaults ?? {}), ...(config.rules.get(rule.id)?.options ?? {}) };
}

/**
 * Lint a set of tools. Tools whose names match an `ignoreTools` pattern
 * are excluded entirely (they count in neither findings nor totals).
 */
export function lintTools(tools: ToolDef[], config: ResolvedConfig = defaultConfig()): LintResult {
  const kept: ToolDef[] = [];
  const keptNames: string[] = [];
  for (const tool of tools) {
    const ignored = typeof tool.name === "string" &&
      config.ignoreTools.some((pattern) => globMatch(pattern, tool.name as string));
    if (!ignored) {
      // Positional fallback names use the post-ignore index so they always
      // agree with the `#N` position shown in reports.
      keptNames.push(displayName(tool, kept.length));
      kept.push(tool);
    }
  }

  const findings: Finding[] = [];
  for (const rule of ALL_RULES) {
    const severity = severityFor(rule, config);
    if (severity === "off") continue;
    const options = optionsFor(rule, config);

    if (rule.scope === "tool" && rule.checkTool) {
      kept.forEach((tool, index) => {
        for (const raw of rule.checkTool!({ tool, name: keptNames[index] as string, index, options })) {
          findings.push({
            rule: rule.id,
            category: rule.category,
            severity,
            tool: keptNames[index] as string,
            toolIndex: index,
            path: raw.path,
            message: raw.message,
            ...(raw.hint !== undefined ? { hint: raw.hint } : {}),
          });
        }
      });
    } else if (rule.scope === "toolset" && rule.checkToolset) {
      for (const raw of rule.checkToolset({ tools: kept, names: keptNames, options })) {
        const toolIndex = raw.toolIndex ?? 0;
        findings.push({
          rule: rule.id,
          category: rule.category,
          severity,
          tool: keptNames[toolIndex] ?? `<tool #${toolIndex + 1}>`,
          toolIndex,
          path: raw.path,
          message: raw.message,
          ...(raw.hint !== undefined ? { hint: raw.hint } : {}),
        });
      }
    }
  }

  findings.sort(
    (a, b) =>
      a.toolIndex - b.toolIndex ||
      a.path.localeCompare(b.path) ||
      a.rule.localeCompare(b.rule) ||
      a.message.localeCompare(b.message),
  );

  return { findings, summary: summarize(findings, kept.length) };
}

/** Count findings per severity plus per-tool coverage. */
export function summarize(findings: Finding[], tools: number): LintSummary {
  const flagged = new Set<number>();
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const finding of findings) {
    flagged.add(finding.toolIndex);
    if (finding.severity === "error") errors += 1;
    else if (finding.severity === "warn") warnings += 1;
    else infos += 1;
  }
  return { errors, warnings, infos, tools, flaggedTools: flagged.size };
}

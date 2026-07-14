/**
 * Output formatters: pretty (human, grouped by tool), compact (one line
 * per finding, grep-friendly), and json (machine-readable, stable keys).
 */
import type { Finding, LintResult, Severity } from "./types.js";
import { VERSION } from "./version.js";

/** One linted input and its result. */
export interface FileResult {
  file: string;
  result: LintResult;
}

/** ANSI color codes, applied only when `color` is true. */
const COLORS: Record<string, string> = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

function paint(text: string, code: string, color: boolean): string {
  return color ? `${COLORS[code] ?? ""}${text}${COLORS["reset"]}` : text;
}

function severityLabel(severity: Severity, color: boolean): string {
  switch (severity) {
    case "error": return paint("error", "red", color);
    case "warn": return paint("warn ", "yellow", color);
    case "info": return paint("info ", "cyan", color);
  }
}

/** `3 errors, 1 warning` style pluralization. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The `✖ N problems (...)` trailer for a set of results. */
export function summaryLine(results: FileResult[], color: boolean): string {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let tools = 0;
  let flagged = 0;
  for (const { result } of results) {
    errors += result.summary.errors;
    warnings += result.summary.warnings;
    infos += result.summary.infos;
    tools += result.summary.tools;
    flagged += result.summary.flaggedTools;
  }
  const problems = errors + warnings + infos;
  if (problems === 0) {
    return paint(`✔ ${plural(tools, "tool")} clean`, "bold", color);
  }
  const parts = [plural(errors, "error"), plural(warnings, "warning")];
  if (infos > 0) parts.push(`${infos} info`);
  const line = `✖ ${plural(problems, "problem")} (${parts.join(", ")}) in ${flagged} of ${plural(tools, "tool")}`;
  return paint(line, "bold", color);
}

/** Group findings by tool index, preserving engine order. */
function groupByTool(findings: Finding[]): Map<number, Finding[]> {
  const groups = new Map<number, Finding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.toolIndex);
    if (bucket === undefined) groups.set(finding.toolIndex, [finding]);
    else bucket.push(finding);
  }
  return groups;
}

/** Human-readable report, grouped by file then tool, with hints. */
export function formatPretty(results: FileResult[], color: boolean): string {
  const lines: string[] = [];
  for (const { file, result } of results) {
    if (result.findings.length === 0) continue;
    lines.push(paint(file, "bold", color));
    for (const [, findings] of groupByTool(result.findings)) {
      const first = findings[0] as Finding;
      lines.push(`  ${paint(first.tool, "bold", color)} ${paint(`#${first.toolIndex + 1}`, "gray", color)}`);
      const ruleWidth = Math.max(...findings.map((f) => f.rule.length));
      for (const finding of findings) {
        const rule = paint(finding.rule.padEnd(ruleWidth), "gray", color);
        lines.push(`    ${severityLabel(finding.severity, color)}  ${rule}  ${finding.message}`);
        if (finding.hint !== undefined) {
          const pad = " ".repeat(4 + 7 + ruleWidth + 2);
          lines.push(paint(`${pad}↳ ${finding.hint}`, "dim", color));
        }
      }
    }
    lines.push("");
  }
  lines.push(summaryLine(results, color));
  return lines.join("\n");
}

/** One line per finding: `file:tool:path: severity rule message`. */
export function formatCompact(results: FileResult[]): string {
  const lines: string[] = [];
  for (const { file, result } of results) {
    for (const finding of result.findings) {
      lines.push(`${file}:${finding.tool}:${finding.path}: ${finding.severity} [${finding.rule}] ${finding.message}`);
    }
  }
  lines.push(summaryLine(results, false));
  return lines.join("\n");
}

/** Machine-readable report with stable key order. */
export function formatJson(results: FileResult[]): string {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let tools = 0;
  for (const { result } of results) {
    errors += result.summary.errors;
    warnings += result.summary.warnings;
    infos += result.summary.infos;
    tools += result.summary.tools;
  }
  const document = {
    toolint: VERSION,
    files: results.map(({ file, result }) => ({
      file,
      summary: result.summary,
      findings: result.findings.map((finding) => ({
        rule: finding.rule,
        category: finding.category,
        severity: finding.severity,
        tool: finding.tool,
        toolIndex: finding.toolIndex,
        path: finding.path,
        message: finding.message,
        ...(finding.hint !== undefined ? { hint: finding.hint } : {}),
      })),
    })),
    summary: { errors, warnings, infos, tools, problems: errors + warnings + infos },
  };
  return JSON.stringify(document, null, 2);
}

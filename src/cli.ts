#!/usr/bin/env node
/**
 * The toolint CLI.
 *
 *   toolint [options] <file...>       lint tool definitions from files
 *   toolint --stdin                   lint tool definitions from stdin
 *   toolint --rules                   list every rule and exit
 *
 * Exit codes: 0 clean (warnings allowed), 1 error-level findings (or
 * --max-warnings exceeded), 2 usage / unreadable input / bad config.
 */
import { readFileSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { pathToFileURL } from "node:url";
import { ToolintConfigError, findConfigFile, loadConfigFile } from "./config.js";
import { defaultConfig, lintTools } from "./engine.js";
import { formatCompact, formatJson, formatPretty, type FileResult } from "./format.js";
import { ToolintParseError, parseToolsJson } from "./parse.js";
import { ALL_RULES } from "./rules/index.js";
import type { ResolvedConfig } from "./types.js";
import { VERSION } from "./version.js";

const USAGE = `toolint ${VERSION} — lint MCP tool JSON Schemas for model usability

Usage:
  toolint [options] <file...>   lint tool definitions from JSON files
  toolint --stdin               lint tool definitions read from stdin
  toolint --rules               list every rule with severity and summary

Input may be a tool array, {"tools": [...]}, a tools/list JSON-RPC
response, or a single tool object (inputSchema/input_schema/parameters).

Options:
  --stdin               read JSON from standard input
  --format <name>       pretty (default), compact, or json
  --config <file>       config file (default: nearest toolint.config.json)
  --no-config           skip config discovery
  --quiet               report errors only (warn/info findings are dropped)
  --max-warnings <n>    exit 1 when more than n warnings are reported
  --no-color            disable ANSI colors (also honors NO_COLOR)
  --rules               print the rule reference and exit
  -h, --help            show this help
  -v, --version         print the version

Exit codes: 0 clean · 1 errors found or --max-warnings exceeded · 2 usage error`;

/** Parsed command-line options. */
interface CliOptions {
  files: string[];
  stdin: boolean;
  format: "pretty" | "compact" | "json";
  configPath?: string;
  noConfig: boolean;
  quiet: boolean;
  maxWarnings?: number;
  color: boolean;
  listRules: boolean;
  help: boolean;
  version: boolean;
}

/** Raised for bad argv; the message is printed to stderr with exit 2. */
export class CliUsageError extends Error {}

/** Parse argv (no runtime deps means no yargs — and none needed). */
export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    stdin: false,
    format: "pretty",
    noConfig: false,
    quiet: false,
    color: true,
    listRules: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-h": case "--help": options.help = true; break;
      case "-v": case "--version": options.version = true; break;
      case "--stdin": options.stdin = true; break;
      case "--rules": options.listRules = true; break;
      case "--no-config": options.noConfig = true; break;
      case "--quiet": options.quiet = true; break;
      case "--no-color": options.color = false; break;
      case "--format": {
        const value = argv[++i];
        if (value !== "pretty" && value !== "compact" && value !== "json") {
          throw new CliUsageError(`--format expects pretty, compact, or json (got ${value ?? "nothing"})`);
        }
        options.format = value;
        break;
      }
      case "--config": {
        const value = argv[++i];
        if (value === undefined) throw new CliUsageError("--config expects a file path");
        options.configPath = value;
        break;
      }
      case "--max-warnings": {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 0) {
          throw new CliUsageError("--max-warnings expects a non-negative integer");
        }
        options.maxWarnings = value;
        break;
      }
      default:
        if (arg.startsWith("-") && arg !== "-") {
          throw new CliUsageError(`unknown option ${arg}`);
        }
        options.files.push(arg);
    }
  }
  return options;
}

/** The `--rules` reference table, aligned for terminals. */
export function renderRuleList(): string {
  const lines: string[] = [`toolint ${VERSION} — ${ALL_RULES.length} rules`, ""];
  const idWidth = Math.max(...ALL_RULES.map((rule) => rule.id.length));
  let category = "";
  for (const rule of ALL_RULES) {
    if (rule.category !== category) {
      category = rule.category;
      lines.push(`${category}:`);
    }
    lines.push(`  ${rule.id.padEnd(idWidth)}  ${rule.defaultSeverity.padEnd(5)}  ${rule.summary}`);
  }
  return lines.join("\n");
}

/** Read all of stdin as UTF-8. */
async function readStdin(): Promise<string> {
  const chunks: BufferLike[] = [];
  for await (const chunk of processStdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Resolve the effective config per the CLI flags. */
function resolveCliConfig(options: CliOptions, cwd: string): ResolvedConfig {
  if (options.configPath !== undefined) return loadConfigFile(options.configPath);
  if (options.noConfig) return defaultConfig();
  const discovered = findConfigFile(cwd);
  return discovered !== undefined ? loadConfigFile(discovered) : defaultConfig();
}

/** Run the CLI. Returns the process exit code. */
export async function runCli(
  argv: string[],
  io: { out: (line: string) => void; err: (line: string) => void },
  cwd: string = process.cwd(),
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (cause) {
    io.err(cause instanceof Error ? `toolint: ${cause.message}` : String(cause));
    io.err("run `toolint --help` for usage");
    return 2;
  }

  if (options.help) { io.out(USAGE); return 0; }
  if (options.version) { io.out(VERSION); return 0; }
  if (options.listRules) { io.out(renderRuleList()); return 0; }
  if (!options.stdin && options.files.length === 0) {
    io.err("toolint: no input — pass one or more JSON files, or --stdin");
    io.err("run `toolint --help` for usage");
    return 2;
  }

  let config: ResolvedConfig;
  try {
    config = resolveCliConfig(options, cwd);
  } catch (cause) {
    if (cause instanceof ToolintConfigError) {
      io.err(`toolint: ${cause.message}`);
      return 2;
    }
    throw cause;
  }

  const results: FileResult[] = [];
  try {
    if (options.stdin) {
      const text = await readStdin();
      results.push({ file: "<stdin>", result: lintTools(parseToolsJson(text, "<stdin>"), config) });
    }
    for (const file of options.files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        io.err(`toolint: cannot read ${file}: ${detail}`);
        return 2;
      }
      results.push({ file, result: lintTools(parseToolsJson(text, file), config) });
    }
  } catch (cause) {
    if (cause instanceof ToolintParseError) {
      io.err(`toolint: ${cause.message}`);
      return 2;
    }
    throw cause;
  }

  if (options.quiet) {
    for (const entry of results) {
      const findings = entry.result.findings.filter((finding) => finding.severity === "error");
      entry.result = {
        findings,
        summary: {
          ...entry.result.summary,
          warnings: 0,
          infos: 0,
          flaggedTools: new Set(findings.map((finding) => finding.toolIndex)).size,
        },
      };
    }
  }

  const color = options.color && process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
  switch (options.format) {
    case "pretty": io.out(formatPretty(results, color)); break;
    case "compact": io.out(formatCompact(results)); break;
    case "json": io.out(formatJson(results)); break;
  }

  const errors = results.reduce((sum, entry) => sum + entry.result.summary.errors, 0);
  const warnings = results.reduce((sum, entry) => sum + entry.result.summary.warnings, 0);
  if (errors > 0) return 1;
  if (options.maxWarnings !== undefined && warnings > options.maxWarnings) {
    io.err(`toolint: ${warnings} warnings exceed --max-warnings ${options.maxWarnings}`);
    return 1;
  }
  return 0;
}

// Invoke only when executed directly (`node dist/cli.js`), not when imported.
const invokedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then(
    (code) => { process.exitCode = code; },
    (cause) => {
      process.stderr.write(`toolint: unexpected failure: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`);
      process.exitCode = 2;
    },
  );
}

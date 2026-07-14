// Shared test helpers: paths, a real-CLI runner, temp dirs, and a
// findings filter used by the rule-focused suites. Tests import the built
// dist/ output, so `npm test` always exercises what ships.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const EXAMPLES = join(ROOT, "examples");
export const CLI = join(ROOT, "dist", "cli.js");

const createdDirs = [];
process.on("exit", () => {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of OS temp space
    }
  }
});

/** A fresh temp directory, removed when the test process exits. */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "toolint-test-"));
  createdDirs.push(dir);
  return dir;
}

/** Run the built CLI in a child process; returns {status, stdout, stderr}. */
export function runCli(args, { input, cwd, env } = {}) {
  const result = spawnSync("node", [CLI, ...args], {
    cwd: cwd ?? ROOT,
    env: { ...process.env, NO_COLOR: "1", ...(env ?? {}) },
    input: input ?? "",
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Lint tools via the library and return only findings for one rule. */
export async function findingsFor(tools, ruleId, config) {
  const { lintTools } = await import("../dist/index.js");
  return lintTools(tools, config).findings.filter((finding) => finding.rule === ruleId);
}

/** A minimal, fully clean tool definition to build fixtures from. */
export function cleanTool(overrides = {}) {
  return {
    name: "search_invoices",
    description: "Search issued invoices by customer name or number and return the matching rows.",
    inputSchema: {
      type: "object",
      properties: {
        customer_name: {
          type: "string",
          description: "Full or partial customer name to match against.",
        },
      },
      required: ["customer_name"],
    },
    ...overrides,
  };
}

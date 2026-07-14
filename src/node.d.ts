/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

interface WritableLike {
  write(chunk: string): boolean;
  isTTY?: boolean;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(p: string): string;
}

declare module "node:url" {
  export function pathToFileURL(path: string): { href: string };
}

declare module "node:process" {
  export const stdin: AsyncIterable<unknown>;
}

interface BufferLike {
  toString(encoding: "utf8"): string;
}

declare const Buffer: {
  from(value: unknown): BufferLike;
  concat(list: BufferLike[]): BufferLike;
};

interface ImportMeta {
  url: string;
}

declare var process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
  stdout: WritableLike;
  stderr: WritableLike;
};

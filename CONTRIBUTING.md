# Contributing to toolint

Issues, discussions and pull requests are all welcome — this project aims to
stay small, zero-dependency at runtime, and deterministic to the byte.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/toolint.git
cd toolint
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 91 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (clean and messy example lints,
all three output formats, stdin, config overrides and discovery, `--quiet`,
`--max-warnings`, and the exit-code contract) and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable modules
   (text heuristics, walker, rules, engine, formatters all take data, not
   streams — only cli.ts touches the filesystem and process).
5. A new or changed rule needs: a one-line `summary`, a `hint` on every
   finding, a docs/rules.md row explaining the model-usability rationale,
   and tests for both the firing and the non-firing case.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core feature;
  adding one needs justification in the PR and will usually be declined.
- No network calls, ever. toolint reads local JSON and writes a report;
  that is the whole I/O surface.
- Determinism is the product: the same input must produce byte-identical
  output — no timestamps, no randomness, no locale-dependent formatting.
- Heuristics are data, not code: extend the verb/generic/ambiguous word
  tables and the placeholder patterns rather than special-casing tool
  names, and pin new entries with tests.
- False positives are worse than false negatives — a linter people mute
  helps nobody. When a heuristic is borderline, require corroboration
  (e.g. `param-name-ambiguous` only fires without a real description).
- Exit codes (0 / 1 / 2), rule ids, and finding paths are stable API;
  do not repurpose them.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `toolint --version` output, the exact command line, the
smallest tool JSON that reproduces the problem (redact server internals
freely — names, descriptions, and schemas are what matter), and for
false-positive reports the rule id plus why the flagged schema is actually
fine for a model.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.

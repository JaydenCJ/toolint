# toolint examples

Everything here is self-contained and offline — run the commands from the
repository root after `npm install && npm run build`.

## Files

| File | What it is |
|---|---|
| `clean-server.tools.json` | A well-authored note-taking server (5 tools). Lints clean: exit 0, zero findings. Use it as a template for new servers. |
| `messy-server.tools.json` | A compact tour of what goes wrong: generic names, TODO descriptions, colliding names, vague enums, broken defaults, phantom `required` entries, negated booleans, deep nesting. 27 findings across 4 tools. |
| `toolint.config.json` | A sample config: disables `enum-large`, demotes `name-verb` to info, tightens `too-many-params` to 6, and ignores `legacy_*` / `debug_*` tools. |

## Lint both examples

```bash
node dist/cli.js examples/clean-server.tools.json    # exit 0, "✔ 5 tools clean"
node dist/cli.js examples/messy-server.tools.json    # exit 1, 27 problems
```

## Things worth trying

```bash
# Machine-readable report for CI dashboards:
node dist/cli.js --format json examples/messy-server.tools.json | head -30

# One grep-friendly line per finding:
node dist/cli.js --format compact examples/messy-server.tools.json

# Apply the sample config (note how name-verb findings become info):
node dist/cli.js --config examples/toolint.config.json examples/messy-server.tools.json

# Lint a live server's catalog straight from a tools/list response:
echo '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"run"}]}}' | node dist/cli.js --stdin

# Errors only, for noisy legacy catalogs:
node dist/cli.js --quiet examples/messy-server.tools.json

# Treat any warning as a build failure in CI:
node dist/cli.js --max-warnings 0 examples/clean-server.tools.json
```

## Capturing a real catalog to lint

toolint lints JSON, so any way you can get a `tools/list` response works.
With an MCP server on stdio, the two-line handshake is:

```bash
{ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"toolint","version":"0.1.0"}}}';
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; } \
  | your-mcp-server | tail -1 | node dist/cli.js --stdin
```

Single tool objects, bare arrays, OpenAI-style `parameters` /
`{"type": "function", ...}` wrappers, and Claude-style `input_schema` are all
accepted — see `src/parse.ts` for the exact normalization.

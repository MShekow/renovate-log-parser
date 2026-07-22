# renovate-log-parser

A CLI that parses Renovate Bot debug logs to auto-detect issues in scheduled Renovate runs, or interactively diagnose issues with your coding agent, or manually via web UI.

## Usage

Run directly with `npx` (no install required):

```bash
# Detect build-breaking problems in a Renovate JSONL log (CI-friendly)
npx renovate-log-parser detect-errors path/to/renovate.jsonl

# Also write a machine-readable JSON report
npx renovate-log-parser detect-errors path/to/renovate.jsonl --out report.json

# Emit token-efficient stats for an AI coding agent
npx renovate-log-parser analyze path/to/renovate.jsonl

# Explore a log interactively in the Nuxt-based web UI
npx renovate-log-parser web path/to/renovate.jsonl
```

Or install globally:

```bash
npm install -g renovate-log-parser
renovate-log-parser --help
```

## Commands

### `detect-errors <path>`

Deterministically scans a Renovate debug log (JSONL) for build-breaking
problems and warnings — designed to gate CI. It prints a human-readable summary
to stdout and, with `--out`, writes a stable machine-readable JSON report.

```bash
renovate-log-parser detect-errors renovate.jsonl [--out report.json] \
  [--ignore-file rules.json] [--fail-on-warn]
```

| Arg / option     | Default                             | Description                                       |
| ---------------- | ----------------------------------- | ------------------------------------------------- |
| `<path>`         | **required**                        | Path to the Renovate JSONL log                    |
| `--out`          | (none)                              | Also write the machine-readable JSON report here  |
| `--ignore-file`  | `./renovate-log-parser.ignore.json` | Ignore-rules file (a missing file means no rules) |
| `--fail-on-warn` | `false`                             | Make warning findings affect the exit code        |

**Exit codes:** `0` = no non-ignored errors · `1` = ≥1 non-ignored error (or, with
`--fail-on-warn`, ≥1 non-ignored warning) · `2` = tool/usage error (bad path,
unreadable, bad args, malformed ignore file).

**Detected categories** — errors: `host-error-abort`, `log-error` (level 50),
`log-fatal` (level 60), `err-object`, `config-migration`; warnings: `warn-log`
(level 40), `repo-problem`, `branch-error`, plus the reserved `abandoned-package`
(always 0 for now). The JSON report's `counts` map always lists every category
(zeros included) for stable run-over-run diffing in CI.

**Ignore file** — silence expected findings with stable keys (line numbers shift
as logs grow). A finding is ignored iff an active rule matches on `category` AND
(optional `message` glob) AND (optional exact `repository`). Rules past their
optional `expires` date are reported to stderr and skipped:

```jsonc
{
  "version": 1,
  "rules": [
    {
      "category": "err-object",
      "message": "*lock file error*", // optional glob (* and ?)
      "repository": "owner/repo", // optional exact match
      "reason": "flaky nuget restore, JIRA-123", // optional, for humans
      "expires": "2026-09-01", // optional ISO date; past => inactive + warn
    },
  ],
}
```

Ignored findings still appear in the report with `"ignored": true`, but are
excluded from the summary counts and the exit code.

### `analyze <path>`

Emits token-efficient structure for an AI coding agent (or a human). Without
`--print` it writes pretty-JSON whole-log **stats** to stdout; with `--print` it
streams a filtered, line-ranged, limited **JSONL** slice of the log (one entry
per line). The intended loop is: read the stats, pick the interesting line
range, then `--print` just that range — reading only what you need.

```bash
# Whole-log stats: level counts + per-repository structure
renovate-log-parser analyze renovate.jsonl

# Print lines 500–560, keeping only npm-manager entries, first 20
renovate-log-parser analyze renovate.jsonl --print \
  --line-from 500 --line-to 560 --filter manager:npm --limit 20

# Print every entry whose msg starts with "Found match at" (case-insensitive)
renovate-log-parser analyze renovate.jsonl --print \
  --filter-with-wildcard "msg:Found match at*"
```

| Arg / option                | Default                               | Description                                                                        |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `<path>`                    | **required**                          | Path to the Renovate JSONL log                                                     |
| `--print`                   | `false`                               | Print matching log lines (JSONL) instead of stats                                  |
| `--ignored-fields`          | `v,time,logContext,pid,hostname,name` | CSV of root keys to strip in print mode (`msg` kept)                               |
| `--line-from` / `--line-to` | (none)                                | Inclusive 0-indexed line range (print mode)                                        |
| `--limit`                   | `50`                                  | Max lines to print (print mode)                                                    |
| `--filter`                  | (none)                                | `key:val` scalar-**equals** filter, repeatable, AND'd                              |
| `--filter-with-wildcard`    | (none)                                | `key:pattern` wildcard filter (`*` = any run), case-insensitive, repeatable, AND'd |
| `--include-original-line`   | `false`                               | Add `_oL` (0-indexed source line) to each object                                   |

**Stats mode** reports `levelCounts` (entries per numeric level) and a `repos`
array — each repository's line span, unique branches, the rowids of its
`branches info extended` and `packageFiles with updates` entries, its
`repoProblems`, and its dependency inventory (`depNames`/`packageNames`, unioning
root-level keys with the `packageFiles with updates` config).

**Print mode** selects rows in order line-range -> filters -> `--limit` (first N
by line order). Output is JSONL on stdout with the ignored root fields stripped
(`msg` is never stripped); when the limit caps the result, a truncation notice is
written to **stderr** so stdout stays a clean, pipeable stream.

Both filter flags target a single root-level key and can be repeated (all
conditions are AND'd, alongside any line range). `--filter` matches the value
**exactly**; its value is auto-typed so it compares against the correctly-typed
JSON — `true`/`false` become booleans and plain numbers become numbers (so
`level:30` matches the numeric `level`), while everything else (including
leading-zero or dotted values like `007` / `1.2.3`) stays a string.
`--filter-with-wildcard` treats `*` as "any run of characters" (nothing else is
special — `?` and `%` are literal) and matches case-insensitively. A pattern is
anchored as written, so use a leading/trailing `*` for prefix/suffix/contains
matching (e.g. `msg:*lock file*`).

**Exit codes:** `0` = success · `2` = tool/usage error (bad path, unreadable, bad
filter token).

### `web`

Starts the bundled [Nuxt](https://nuxt.com) web UI (with [Nuxt UI](https://ui.nuxt.com)
and Nuxt's built-in Nitro server) for interactive, filtered log exploration. Pass
an optional log path to open it automatically; otherwise use the in-app file
picker. The server keeps the parsed log in memory (SQLite-backed) and streams
paged rows to the client.

| Arg / option | Default     | Description                                        |
| ------------ | ----------- | -------------------------------------------------- |
| `[path]`     | (none)      | Renovate JSONL log to open automatically in the UI |
| `--port`     | `3000`      | Port to listen on                                  |
| `--host`     | `localhost` | Host to bind to                                    |
| `--open`     | `true`      | Open the web UI in your browser                    |

```bash
# Open the UI on a specific log
renovate-log-parser web path/to/renovate.jsonl

# Just start the server (pick a file from inside the UI)
renovate-log-parser web --port 4000 --no-open
```

**The viewer** renders every log line in a virtualized, fixed-height list — a
colored level glyph (`T/D/I/W/E/F`) plus the entry's `msg`.
Clicking a row's arrow opens a details slide-over with a recursive,
collapsible JSON tree of the full entry.

**Filtering** (all AND'd, debounced):

- **Log levels** — a dropdown to show/hide entries by level.
- **Repositories** — include/exclude by repository, plus a
  "Repository-independent" pseudo-group for entries with no `repository`.
- **Ignored fields** — hide noisy root keys from the row list (`msg` is always
  kept).
- **Free-text search** — a field selector whose first entry, **Raw search**,
  matches the whole line (any key or value); any other field does a
  case-insensitive `*`-wildcard match scoped to that field.
- **Pills** — dynamic, individually toggleable/removable filters created from row
  and JSON-tree context menus (e.g. show-only/hide a `field`, or a
  `field == value`; nested keys create a scoped "contains" search on their
  top-level ancestor).

## Development

This repository is an npm workspace: the publishable CLI lives at the root and
the Nuxt app lives in [`web/`](./web).

```bash
# Install all workspace dependencies
npm install

# Run the CLI from source (no build step) via tsx
npm run dev:cli -- detect-errors path/to/renovate.jsonl
npm run dev:cli -- web

# Run the Nuxt app in dev mode (HMR) directly
npm run dev:web

# Build everything (Nuxt .output + compiled CLI)
npm run build

# Run the compiled CLI
node dist/cli.js --help
```

### Linting & formatting

[ESLint](https://eslint.org) (flat config) and [Prettier](https://prettier.io) are set up at the workspace root.

```bash
npm run lint          # ESLint for src/ (type-aware) + web/ (Nuxt rules)
npm run format        # Prettier write pass over all non-ignored files
npm run format:check  # Prettier check (no writes — useful in CI)
```

- **Root (`src/`)** — [`eslint.config.mjs`](./eslint.config.mjs) uses `typescript-eslint` `recommendedTypeChecked` rules against `src/**/*.ts`, with `eslint-config-prettier` appended to disable any rules that conflict with Prettier. Prettier itself runs with its defaults (semicolons, double quotes, trailing commas).
- **Web (`web/`)** — [`web/eslint.config.mjs`](./web/eslint.config.mjs) delegates to the auto-generated `@nuxt/eslint` config, which covers Vue, TypeScript, and Nuxt-specific rules. The `web/` directory is excluded from the root ESLint and Prettier configs so the two setups stay independent.

### How it's built

- **CLI** — TypeScript compiled with `tsc` to ESM in `dist/`. Uses
  [`yargs`](https://yargs.js.org) for command parsing. `yargs` is the only
  runtime dependency.
- **Web** — a Nuxt UI app built with `nuxt build`. It shares the CLI's parsing
  and filtering logic from `src/core/` (aliased into the bundle as
  `renovate-core`), so the browser and the CLI query the same SQLite-backed
  model. The `web` command runs the self-contained Nitro server
  (`web/.output/server/index.mjs`) as a child process; when given a log path it
  hands it off to the UI via a `?log=` query parameter.

### What gets published

Two `package.json` mechanisms cooperate so that both build outputs ship to npm:

- **`files: ["dist", "web/.output"]`** — an allow-list of what goes into the
  published tarball. npm always adds `package.json`, `README`, `LICENSE`, and the
  `bin` target, then includes everything matched here — both directories,
  recursively. This list takes precedence over `.gitignore`, which is why
  `web/.output/` (gitignored as a build artifact) is still published.
- **`prepublishOnly: "npm run build"`** — a lifecycle hook npm runs automatically
  before packing on `npm publish`. It builds the Nuxt `.output` and compiles the
  CLI `dist`, so both directories exist and are current by the time the `files`
  allow-list is evaluated.

```
npm publish
  └─ prepublishOnly → npm run build → build:web (nuxt build → web/.output/)
                                    → build:cli (tsc        → dist/)
  └─ pack tarball using `files`: dist/ + web/.output/ (+ package.json, README, LICENSE)
  └─ upload to registry
```

The result is a lean, self-contained package (no source or `node_modules` leak).
Verify locally with `npm pack --dry-run`.

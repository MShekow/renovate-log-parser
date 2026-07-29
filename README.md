# renovate-log-parser

`renovate-log-parser` is a CLI and web interface for manual and automated analyses of Renovate Bot debug logs (JSONL-formatted), which you get by either downloading a run's log from [https://developer.mend.io](https://developer.mend.io) (if you use Mend's _hosted_ GitHub app), or by setting the `LOG_FILE` environment variable for self-hosted Renovate.

`renovate-log-parser` offers the following commands:

- `detect-errors` is meant for CI pipelines; it scans the log for build-breaking problems and warnings and exits with error, helping you detect and solve hidden Renovate issues you would otherwise miss
- `analyze` (with a corresponding SKILL.md) tells your coding agent (Codex, Copilot, Claude Code, etc.) about the log's structure, allowing it to efficiently read only the most relevant log lines in a token-efficient way, so that it can quickly (and cheaply) diagnose Renovate problems
- `web` starts a temporary local web server that parses the log and serves a browser-based interface that you use to analyze and filter Renovate logs of _any_ length; this solves the problem of tedious, manual “grep”-like analyses where your text editor chokes on too large files

## Background (why do I need this)

This tool was born out of the need to solve various problems, such as:

- Setting up Renovate in a project with many repositories (and development teams) is easy. But over time, subtle problems creep in that no one seems to notice. For instance, Renovate might stop creating PRs for intricate reasons, and it only posts a small notice-block about this problem to the _Dependency dashboard_ GitHub issue. Unfortunately, the development teams use _Jira_ for issues and never look at GitHub issues, so the problems remain unnoticed.
- In practice, developers sometimes have problems with Renovate Bot. They wonder why Renovate does not do certain things (even though they think it should), or they are annoyed that Renovate does certain things they don't want it to do. Manual analysis (given the huge debug-level log) is very difficult for non-experts, as important information is often buried in _debug_\-level log lines rather than warning- or error-level log lines. And AI agents miss important information in large log files, or spend enormous amounts of tokens for the analysis. As a consequence, people tend to accept a sub-optimal Renovate configuration or become frustrated with Renovate in general.

Consequently, a tool was needed that detects such subtle problems automatically, and that simplifies manual and AI-assisted analyses of Renovate log files.

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

**Exit codes:**

- `0` = no non-ignored errors
- `1` = ≥1 non-ignored error (or, with `--fail-on-warn`, ≥1 non-ignored warning)
- `2` = tool/usage error (bad path, unreadable, bad args, malformed ignore file)

**Detected categories**:

- **Errors** (things Renovate would _not_ otherwise flag in a PR comment):
  - `host-error-abort`: when Renovate skipped creating/updating PRs for a repository because one or more well-known registries were unreachable; looks for a `Repository finished` entry with `result: "external-host-error"`
  - `log-error`: lines with error level (level=50)
  - `log-fatal`: lines with fatal level (level=60)
  - `config-migration`: when a repository needs a renovate.json migration; looks for a `Config migration necessary` entry carrying `oldConfig` + `newConfig`
  - `abandoned-package`: when a repository contains one or more abandoned packages for which Renovate would not create a PR; reports one finding per package in an `Abandoned package statistics` entry
- **Warnings**:
  - `log-warn`: lines with warning level (level=40)
  - `err-object`: reports lines with an `err` object, such as rawExec errors
  - `repo-problem`: reports entries in `repoProblems` lines (which is a string-array)

The JSON report's `counts` map always lists every category (zeros included) for stable run-over-run diffing in CI.

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
`--print` it writes compact single-line JSON whole-log **stats** to stdout; with `--print` it
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

### `install-analyze-skill`

Writes (or updates) a `renovate-log-analyzer` **SKILL.md** that teaches an AI
coding agent (Codex, Copilot, Claude Code, …) how to drive the `analyze` command
token-efficiently. It can optionally embed instructions for fetching the
log from GitHub self-hosted Renovate workflows via the `gh` CLI.

The command is interactive by default: it asks whether to install the skill
**locally** or **globally**, and whether to include the GitHub-fetch section
(and if so, the base URL, organization, repository, and Renovate workflow
filename). All answers can also be supplied as flags to run non-interactively
(e.g. in CI); any flag you pass skips its prompt.

```bash
# Interactive
npx renovate-log-parser install-analyze-skill

# Non-interactive, local, with a GitHub Enterprise fetch section
npx renovate-log-parser install-analyze-skill --scope local --with-gh \
  --gh-base-url github.example.com \
  --gh-org acme --gh-repo app --gh-workflow renovate.yml
```

The skill is written to
`<root>/.agents/skills/renovate-log-analyzer/SKILL.md`, where `<root>` is the
current working directory (`local`) or your home directory (`global`).

| Arg / option    | Default        | Description                                                            |
| --------------- | -------------- | ---------------------------------------------------------------------- |
| `--scope`       | (prompt)       | `local` (`<cwd>/.agents/skills`) or `global` (`~/.agents/skills`)      |
| `--with-gh`     | (prompt)       | Include a "fetch logs from GitHub via `gh`" section                    |
| `--gh-base-url` | (prompt if gh) | GitHub Enterprise host (e.g. `github.example.com`); blank = github.com |
| `--gh-org`      | (prompt if gh) | GitHub organization/owner                                              |
| `--gh-repo`     | (prompt if gh) | Repository name                                                        |
| `--gh-workflow` | (prompt if gh) | Filename of the workflow that runs Renovate (e.g. `renovate.yml`)      |
| `--yes`         | `false`        | Skip all prompts; fail if a required answer is missing                 |

**Exit codes:** `0` = success · `2` = tool/usage error (missing required answer
when non-interactive, or a write failure).

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

### Testing

```bash
npm test           # Unit + fixture tests (fast; no build, no network)
npm run test:fixtures  # Only the fixture tests
npm run test:e2e   # Packaging E2E tests (slow: builds, packs, installs)
```

Three suites, each catching a different failure class:

- **Unit tests** (`src/core/__tests__/*.test.ts`) — synthetic, hand-written
  JSONL logs asserting the detection contracts in isolation.
- **Fixture tests** (`src/core/__tests__/fixtures.test.ts`) — the full
  Parser → ErrorDetector/Analyzer pipeline run over _real_ Renovate logs
  captured against
  [`MShekow/renovate-log-parser-test`](https://github.com/MShekow/renovate-log-parser-test)
  and committed under `src/core/__tests__/fixtures/`:

  | Fixture                       | What it demonstrates                                                                                                                                                 |
  | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `external-host-error.jsonl`   | NPM registry blocked → the run aborts with `result: "external-host-error"`                                                                                           |
  | `various-issues.jsonl`        | Abandoned packages, a required config migration, and an npm `lock file error` whose `err.stderr` reports a `Conflicting peer dependency`                             |
  | `failed-dotnet-install.jsonl` | `builds.dotnet.microsoft.com` blocked → `Datasource connection error` (`DEPTH_ZERO_SELF_SIGNED_CERT`) and `Failed to generate lock file` / "No tool releases found." |

  The assertions are deliberately _semantic_ rather than snapshot-based, since a
  Renovate log is full of volatile data (timestamps, pid, hostname, logContext,
  dependency versions). They assert only the signals each scenario was captured
  to demonstrate.

- **Packaging E2E tests** (`e2e/pack-install.e2e.ts`) — build, `npm pack`,
  install the tarball into an empty throwaway project, then drive the installed
  `renovate-log-parser` binary against a fixture. This is the only suite that
  can catch a missing `package.json#files` entry, a dropped Nuxt `.output`
  symlink, or a `dist/` import that only resolved because `src/` sat next to it.
  (E2E coverage for the `web` command is deferred; only the presence of its
  build output is asserted.) Set `SKIP_E2E=1` to skip.

### Regenerating the log fixtures

The [`compose.yml`](./compose.yml) stack runs Renovate against the test
repository, with an NGINX "firewall" that Docker DNS points selected hostnames
at, so outbound access to them fails exactly as it would behind a corporate
proxy. The base file blocks nothing; each scenario layers on an override that
adds the hostnames it needs to block:

```bash
# Requires a .env with GITHUB_PAT (+ optionally LOCAL_UID / LOCAL_GID)
docker compose -f compose.yml up -d                                         # various-issues
docker compose -f compose.yml -f compose.external-host-error.yml up -d      # external-host-error
docker compose -f compose.yml -f compose.failed-dotnet-install.yml up -d    # failed-dotnet-install

docker compose ... wait renovate        # block until Renovate exits
cp container-out-logs/out.log src/core/__tests__/fixtures/<scenario>.jsonl
docker compose ... down -v              # discard the generated certificate
```

Renovate must start from a _pristine_ repository — leftover `renovate/*`
branches make it take a different code path ("Branch already exists") and skip
the very work the fixture captures. Close and delete them first.

[`.github/workflows/verify-fixtures.yml`](./.github/workflows/verify-fixtures.yml)
automates all of this weekly (and on demand): one job per scenario, run strictly
in sequence since they share one test repository, each starting by wiping every
Renovate PR and branch. It overwrites the committed fixture with the freshly
generated log and re-runs the fixture tests against it — so a Renovate release
that renames a message or drops a field turns the workflow red. Nothing is
committed back; the regenerated log is uploaded as an artifact so the fixture
can be updated deliberately. The workflow needs a `TEST_REPO_PAT` secret (a
fine-grained PAT with contents + pull-request write access to the test repo).

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

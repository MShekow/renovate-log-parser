# renovate-log-parser

<p align="center"><img src="./renovate-log-parser.webp" width="400" /></p>

https://github.com/user-attachments/assets/141eddd0-1a4f-4b70-b09c-c10e6dca10ee

`renovate-log-parser` is a CLI and web interface for manual and automated analyses of Renovate Bot debug logs (JSONL-formatted), which you get by either downloading a run's log from [https://developer.mend.io](https://developer.mend.io) (if you use Mend's _hosted_ GitHub app), or by setting the `LOG_FILE` environment variable for self-hosted Renovate.

`renovate-log-parser` offers the following commands:

- `detect-errors` is meant for CI pipelines; it scans the log for potential problems and warnings and exits with error, helping you detect and solve hidden Renovate issues you would otherwise miss
- `analyze` (with a corresponding SKILL.md) tells your coding agent (Codex, Copilot, Claude Code, etc.) about the log's structure, allowing it to efficiently read only the most relevant log lines in a token-efficient way, so that it can quickly (and cheaply) diagnose Renovate problems
- `web` starts a temporary local web server that parses the log and serves a browser-based interface that you use to analyze and filter Renovate logs of _any_ length; this solves the problem of tedious, manual “grep”-like analyses where your text editor chokes on too large files
- `install-analyze-skill` writes a SKILL.md into your project or home directory, optionally including instructions for pulling the log straight from your GitHub Actions Renovate runs — so your agent knows both how to get a log and how to read it

Want to try it right away? Grab an example log and open it in the web UI:

```bash
curl -sSLO https://raw.githubusercontent.com/MShekow/renovate-log-parser/main/src/core/__tests__/fixtures/various-issues.jsonl
npx renovate-log-parser web various-issues.jsonl
```

<details>
<summary>Or, if you prefer Docker (mounting the log into the container and mapping the port)</summary>

```bash
curl -sSLO https://raw.githubusercontent.com/MShekow/renovate-log-parser/main/src/core/__tests__/fixtures/various-issues.jsonl
docker run --rm -it -p 3000:3000 -v "$PWD/various-issues.jsonl:/logs/various-issues.jsonl:ro" node:26-alpine \
  npx -y renovate-log-parser web /logs/various-issues.jsonl --host 0.0.0.0 --no-open
```

Once the container reports that the server is listening, open the UI from a
second terminal — the `?log=` parameter is the path _inside_ the container, and
makes the UI load the file right away (`open` instead of `xdg-open` on macOS):

```bash
xdg-open "http://localhost:3000/?log=/logs/various-issues.jsonl"
```

</details>

## Background (why do I need this)

This tool was born out of the need to solve various problems, such as:

- Setting up Renovate in a project with many repositories (and development teams) is easy. But over time, subtle problems creep in that no one seems to notice. For instance, Renovate might stop creating PRs for intricate reasons, and it only posts a small notice-block about this problem to the _Dependency dashboard_ GitHub issue. Unfortunately, the development teams use _Jira_ for issues and never look at GitHub issues, so the problems remain unnoticed.
- In practice, developers sometimes have problems with Renovate Bot. They wonder why Renovate does not do certain things (even though they think it should), or they are annoyed that Renovate does certain things they don't want it to do. Manual analysis (given the huge debug-level log) is very difficult for non-experts, as important information is often buried in _debug_\-level log lines rather than warning- or error-level log lines. And AI agents miss important information in large log files, or spend enormous amounts of tokens for the analysis. As a consequence, people tend to accept a sub-optimal Renovate configuration or become frustrated with Renovate in general.

Consequently, a tool was needed that detects such subtle problems automatically, and that simplifies manual and AI-assisted analyses of Renovate log files.

## Usage

Run directly with `npx` (no install required):

```bash
# Detect potential problems in a Renovate JSONL log (CI-friendly)
npx renovate-log-parser detect-errors path/to/renovate.jsonl

# Also write a machine-readable JSON report
npx renovate-log-parser detect-errors path/to/renovate.jsonl --out report.json

# Emit token-efficient stats for an AI coding agent
npx renovate-log-parser analyze path/to/renovate.jsonl

# Explore a log interactively in the web UI
npx renovate-log-parser web path/to/renovate.jsonl
```

Or install globally:

```bash
npm install -g renovate-log-parser
renovate-log-parser --help
```

## Commands

### `detect-errors <path>`

Deterministically scans a Renovate debug log (JSONL) for potential
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
**locally** or **globally**, and whether to include the GitHub-fetch section —
which assumes you run self-hosted Renovate as a GitHub Actions workflow in a
repository (and if so, the repository as `org/repo`, the Renovate workflow
filename, and the base URL). All answers can also be supplied as flags to run
non-interactively (e.g. in CI); any flag you pass skips its prompt.

```bash
# Interactive
npx renovate-log-parser install-analyze-skill

# Non-interactive, local, with a GitHub Enterprise fetch section
npx renovate-log-parser install-analyze-skill --scope local --with-gh \
  --gh-base-url github.example.com \
  --gh-repo acme/app --gh-workflow renovate.yml
```

The skill is written to
`<root>/.agents/skills/renovate-log-analyzer/SKILL.md`, where `<root>` is the
current working directory (`local`) or your home directory (`global`).

| Arg / option    | Default        | Description                                                            |
| --------------- | -------------- | ---------------------------------------------------------------------- |
| `--scope`       | (prompt)       | `local` (`<cwd>/.agents/skills`) or `global` (`~/.agents/skills`)      |
| `--with-gh`     | (prompt)       | Include a "fetch logs from GitHub via `gh`" section                    |
| `--gh-base-url` | (prompt if gh) | GitHub Enterprise host (e.g. `github.example.com`); blank = github.com |
| `--gh-repo`     | (prompt if gh) | Repository as `org/repo` (e.g. `acme/app`)                             |
| `--gh-workflow` | (prompt if gh) | Filename of the workflow that runs Renovate (e.g. `renovate.yml`)      |
| `--yes`         | `false`        | Skip all prompts; fail if a required answer is missing                 |

**Exit codes:** `0` = success · `2` = tool/usage error (missing required answer
when non-interactive, or a write failure).

### `web`

Starts the bundled web UI for interactive, filtered log exploration: a
statically-rendered [Nuxt](https://nuxt.com) SPA (with
[Nuxt UI](https://ui.nuxt.com)) served by a small
[Express](https://expressjs.com) server that also exposes the `/api` endpoints.
Pass an optional log path to open it automatically; otherwise use the in-app file
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

The affordances that cannot be discovered by looking — the two context menus
above all, but also the pill click/✕ semantics, the `*` search rules and what
"Hidden fields" actually does — are documented in the UI itself, behind the
**Help** button in the header.

## Development

This repository is an npm workspace: the publishable CLI and the Express web
server live at the root (`src/`), the Nuxt frontend lives in [`web/`](./web).

```bash
# Install all workspace dependencies
npm install

# Run the CLI from source (no build step) via tsx
npm run dev:cli -- detect-errors path/to/renovate.jsonl
npm run dev:cli -- web

# Run the web UI in dev mode: two processes, in two terminals.
# The Nuxt dev server (HMR) proxies /api to the Express server on port 3001.
npm run dev:api   # Express API on :3001 (tsx watch)
npm run dev:web   # Nuxt dev server on :3000

# Build everything (static SPA in web/.output/public + compiled CLI)
npm run build

# Run the compiled CLI
node dist/cli.js --help
```

### Testing

```bash
npm test           # Unit + fixture tests (fast; no build, no network)
npm run test:fixtures  # Only the fixture tests
npm run test:e2e   # Packaging E2E tests (slow: builds, packs, installs)

# One-off, needed by the browser tests inside the E2E suite:
npx playwright-core install chromium

npm run test:e2e:screenshots         # + pixel comparison, in Docker
npm run test:e2e:screenshots:update  # rewrite the committed baselines
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
  can catch a missing `package.json#files` entry or a `dist/` import that only
  resolved because `src/` sat next to it.
  Set `SKIP_E2E=1` to skip.

  Its nested `web UI` block starts the installed `web` command and drives the
  real UI in a headless Chromium, using the `playwright-core` _library_ — there
  is no second test runner or config file, these are plain `node:test` cases in
  the same file. Because they run against the installed tarball, they assert
  that the shipped server actually boots and serves the SPA, not merely that its
  files are present. Chromium must be installed once with
  `npx playwright-core install chromium`; when a browser test fails, a
  screenshot, an HTML dump and the captured console/server output are written to
  `e2e-artifacts/` (CI uploads them as a build artifact).

### Screenshot tests

The last four cases in the `web UI` block compare the live UI against the PNGs
committed under [`e2e/screenshots/`](./e2e/screenshots) — the empty state, a
loaded log, the Problems slide-over and the details slide-over. **Any** differing
pixel fails the test. Locator-based assertions cannot see a broken layout, a
level glyph that lost its colour, or a Nuxt UI upgrade that reflows the header;
this is the only suite that can.

Pixels are decided by more than the code: the Chromium build, the installed font
files and the fontconfig rasterisation settings all change the output. A baseline
is therefore only meaningful against a frozen environment, so the comparison runs
inside the container built from [`e2e/Dockerfile`](./e2e/Dockerfile) — pinned base
image, Chromium pinned to the `playwright-core` version in `package.json`, and a
fixed grayscale-antialiasing/hinting config. Outside that container the four
cases skip themselves, so a plain `npm run test:e2e` keeps working as before.

```bash
npm run test:e2e:screenshots         # build the image, run the suite, compare
npm run test:e2e:screenshots:update  # same, but rewrite the baselines
```

Both build the image (cached after the first run) and mount the work tree as your
own UID, so nothing root-owned is left behind. On a mismatch the expected, actual
and diff images are written to `e2e-artifacts/` and uploaded by CI.

After an intended UI change, run the update script, **look at the regenerated
PNGs**, and commit them alongside the change — a baseline diff is part of the
review, not a chore to rubber-stamp. Upgrading `@nuxt/ui`, `tailwindcss` or
`playwright-core` will usually require the same, since all three move pixels.

For this to hold, `Public Sans` is self-hosted via `@fontsource/public-sans`
rather than merely declared: an unloaded font falls back to whatever
`sans-serif` the viewer's OS provides, which made the UI render differently on
every machine.

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
  [`yargs`](https://yargs.js.org) for command parsing.
- **Frontend** — a Nuxt UI app built with `nuxt generate` and `ssr: false`, i.e.
  a purely client-side SPA: `web/.output/public` holds an app shell plus static
  assets, and nothing of Nitro/h3 is shipped or run. It shares the CLI's
  filtering model and level metadata from `src/core/` (aliased into the bundle
  as `renovate-core`), so the browser and the CLI speak about the same
  SQLite-backed model.
- **Backend** — a plain Express server in [`src/server/`](./src/server),
  compiled by the same `tsc` pass as the CLI. It imports `src/core/` through
  ordinary relative imports (no bundler, no alias), serves the `/api` routes
  from `api.ts`, and serves the static SPA with an `index.html` fallback so
  client-side routing works. `log-registry.ts` holds the process-wide "current
  log" (one open `Parser`/SQLite handle per loaded md5, plus a memoized error
  report). The `web` command spawns `dist/server/server-main.js` as a child
  process; when given a log path it hands it off to the UI via a `?log=` query
  parameter.

### What gets published

Two `package.json` mechanisms cooperate so that both build outputs ship to npm:

- **`files: ["dist", "web/.output/public"]`** — an allow-list of what goes into the
  published tarball. npm always adds `package.json`, `README`, `LICENSE`, and the
  `bin` target, then includes everything matched here — both directories,
  recursively. This list takes precedence over `.gitignore`, which is why
  `web/.output/` (gitignored as a build artifact) is still published.
- **`prepublishOnly: "npm run build"`** — a lifecycle hook npm runs automatically
  before packing on `npm publish`. It generates the static SPA and compiles the
  CLI + server `dist`, so both directories exist and are current by the time the
  `files` allow-list is evaluated.

```
npm publish
  └─ prepublishOnly → npm run build → build:web (nuxt generate → web/.output/public/)
                                    → build:cli (tsc           → dist/)
  └─ pack tarball using `files`: dist/ + web/.output/public/ (+ package.json, README, LICENSE)
  └─ upload to registry
```

The result is a lean, self-contained package (no source or `node_modules` leak).
Verify locally with `npm pack --dry-run`.

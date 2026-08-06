# renovate-log-parser

<p align="center"><img src="./renovate-log-parser.webp" width="400" /></p>

https://github.com/user-attachments/assets/f99595b5-d8bc-4dca-a662-550e502f05f4

`renovate-log-parser` is a CLI and web interface for manual and automated analysis of Renovate Bot debug logs in JSONL format.

To get this log: if you use the _hosted_ Mend GitHub app, download a run log from [https://developer.mend.io](https://developer.mend.io). For self-hosted Renovate, set the `LOG_FILE` environment variable.

`renovate-log-parser` offers the following commands:

- `detect-errors` scans the log for potential problems and warnings. If it finds a problem, it exits with an error and reports the cause. This solves hidden Renovate issues you would otherwise miss.
- `analyze` reports the log structure. A SKILL.md teaches coding agents to read relevant lines and diagnose Renovate problems with fewer tokens.
- `web` starts a temporary local web server. The server parses logs of _any_ length and provides an interface for analysis and filtering. This interface replaces manual “grep”-like analysis that can overwhelm a text editor.
- `install-analyze-skill` writes a SKILL.md to your project or home directory. It can include instructions to get logs from self-hosted Renovate runs in GitHub Actions. Your agent then knows how to get and read a log.

To try it now, download an example log and open it in the web UI:

```bash
curl -sSLO https://raw.githubusercontent.com/MShekow/renovate-log-parser/main/src/core/__tests__/fixtures/various-issues.jsonl
npx renovate-log-parser web various-issues.jsonl
```

<details>
<summary>Or use Docker to mount the log in the container and map the port</summary>

```bash
curl -sSLO https://raw.githubusercontent.com/MShekow/renovate-log-parser/main/src/core/__tests__/fixtures/various-issues.jsonl
docker run --rm -it -p 3000:3000 -v "$PWD/various-issues.jsonl:/logs/various-issues.jsonl:ro" node:26-alpine \
  npx -y renovate-log-parser web /logs/various-issues.jsonl --host 0.0.0.0 --no-open
```

When the container reports that the server is listening, open the UI from a second terminal:

```bash
xdg-open "http://localhost:3000/?log=/logs/various-issues.jsonl"
```

The `?log=` parameter contains the path _inside_ the container. This parameter makes the UI load the file immediately. On macOS, use `open` instead of `xdg-open`:

</details>

## Background (why you need this)

This tool solves these problems:

- Renovate is easy to configure for projects with many repositories and development teams. However, subtle problems can occur later without notice. For example, Renovate can stop creating PRs for complex reasons. It only adds a small notice block to the _Dependency dashboard_ GitHub issue. Teams that use _Jira_ can miss this notice because they do not read GitHub issues.
- Developers do not always understand the actions of Renovate Bot. Renovate can omit expected actions or do unwanted actions. Manual analysis is difficult for non-experts because the debug-level log is overly verbose. Important information often occurs in _debug_\-level lines, not warning- or error-level lines. AI agents can miss information in large logs or use many tokens for analysis. Consequently, users accept a suboptimal Renovate configuration or become frustrated with Renovate.

This tool automatically detects these subtle problems. It also makes manual and AI-assisted analysis of Renovate log files simpler.

## Usage

Run the tool directly with `npx`. You do not have to install it:

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

Alternatively, install the tool globally:

```bash
npm install -g renovate-log-parser
renovate-log-parser --help
```

## Commands

### `detect-errors <path>`

This command scans a Renovate debug log (JSONL) for potential problems and warnings. It uses deterministic rules to gate CI.

The command prints a readable summary to stdout. With `--out`, it writes a stable JSON report for machine processing. It can be used for comparisons between CI runs.

```bash
renovate-log-parser detect-errors renovate.jsonl [--out report.json] \
  [--ignore-file rules.json] [--fail-on-warn]
```

| Arg / option     | Default                             | Description                                 |
| ---------------- | ----------------------------------- | ------------------------------------------- |
| `<path>`         | **required**                        | Path to the Renovate JSONL log              |
| `--out`          | (none)                              | Path to the machine-readable JSON report    |
| `--ignore-file`  | `./renovate-log-parser.ignore.json` | Ignore file (a missing file means no rules) |
| `--fail-on-warn` | `false`                             | Include warning findings in the exit code   |

**Exit codes:**

- `0` = no non-ignored errors
- `1` = ≥1 non-ignored error (or ≥1 non-ignored warning with `--fail-on-warn`)
- `2` = tool/usage error (bad path, unreadable, bad args, malformed ignore file)

**Detected categories**:

- **Errors** (conditions that Renovate does _not_ otherwise flag in a PR comment):
  - `host-error-abort`: Renovate skipped PR creation or updates because it was unable to reach one or more well-known registries. The detector looks for a `Repository finished` entry with `result: "external-host-error"`.
  - `log-error`: lines with error level (level=50)
  - `log-fatal`: lines with fatal level (level=60)
  - `config-migration`: a repository needs a renovate.json migration. The detector looks for a `Config migration necessary` entry that contains `oldConfig` + `newConfig`.
  - `invalid-config`: a repository's own Renovate config did not parse, or failed validation. Renovate aborts the run during `init`, so it extracts nothing and creates no PR. The detector looks for a `Repository has invalid config` entry and reports the offending file (`validationSource`) with the reason (`validationError`, `validationMessage`). Renovate logs this at warning level and still exits with code 0, which makes it easy to miss.
  - `abandoned-package`: a repository contains one or more abandoned packages for which Renovate does not create a PR. The detector reports one finding per package in an `Abandoned package statistics` entry.
- **Warnings**:
  - `log-warn`: lines with warning level (level=40)
  - `err-object`: reports lines with an `err` object, such as rawExec errors
  - `repo-problem`: reports entries in `repoProblems` lines, which contain a string array

The `counts` map in the JSON report always lists every category, including zero counts. This structure keeps comparisons between CI runs stable.

**Ignore file**: Use stable keys to hide expected findings because line numbers change as logs grow.

An active rule must match `category`. If it contains `message` or `repository`, these values must also match.

If a rule is past its optional `expires` date, the tool reports it to stderr and skips it:

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

Ignored findings remain in the report with `"ignored": true`. The summary counts and exit code exclude them.

### `analyze <path>`

This command provides a token-efficient structure for an AI coding agent or a person.

Without `--print`, it writes compact, single-line JSON **stats** for the complete log to stdout. With `--print`, it streams a filtered, line-ranged, and limited **JSONL** section. Each entry uses one line.

The intended loop is:
First, read the statistics. Then select the relevant line range. Use `--print` to read only that range.

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

**Stats mode** reports `levelCounts`, which contains the entry count for each numeric level. It also reports a `repos` array.

For each repository, this array contains the line range, unique branches, and rowids of `branches info extended` entries. It also contains rowids of `packageFiles with updates` entries, `repoProblems`, and the dependency inventory. This inventory combines root-level `depNames`/`packageNames` keys with the `packageFiles with updates` configuration.

**Print mode** selects rows in this order: line range, filters, then `--limit`. The limit selects the first N rows in line order.

The output is JSONL on stdout without the ignored root fields. The command never removes `msg`.

When the limit restricts the result, the command writes a truncation notice to **stderr**. Therefore, stdout remains a clean stream for pipes.

Both filter flags target one root-level key. You can repeat them, and all conditions use AND logic with the line range.

`--filter` matches the value **exactly**. The command converts its value to a typed JSON value for comparison.

The values `true` and `false` become Boolean values. Plain numbers become numbers, so `level:30` matches the numeric `level`.

All other values remain strings. This rule includes values with leading zeros or dots, such as `007` or `1.2.3`.

`--filter-with-wildcard` treats `*` as "any run of characters" and uses a case-insensitive match. The characters `?` and `%` remain literal.

The command anchors the pattern as written. Use a leading or trailing `*` for prefix, suffix, or contains matches. For example, use `msg:*lock file*`.

**Exit codes:** `0` = success · `2` = tool/usage error (bad path, unreadable, bad filter token).

### `install-analyze-skill`

This command writes or updates a `renovate-log-analyzer` **SKILL.md**. The skill teaches an AI coding agent how to use `analyze` with fewer tokens.

The agent can be Codex, Copilot, Claude Code, or another coding agent. The skill can include instructions to get logs from self-hosted Renovate workflows in GitHub Actions with the `gh` CLI.

By default, the command is interactive. It asks whether to install the skill **locally** or **globally**.

It also asks whether to include the GitHub fetch section. This section applies to self-hosted Renovate in a GitHub Actions workflow.

If you include this section, provide the repository as `org/repo`, the Renovate workflow filename, and the base URL.

Provide all answers as flags to run without prompts. Use these flags in CI. Each provided flag skips its prompt.

```bash
# Interactive
npx renovate-log-parser install-analyze-skill

# Non-interactive, local, with a GitHub Enterprise fetch section
npx renovate-log-parser install-analyze-skill --scope local --with-gh \
  --gh-base-url github.example.com \
  --gh-repo acme/app --gh-workflow renovate.yml
```

The command writes the skill to `<root>/.agents/skills/renovate-log-analyzer/SKILL.md`. The `<root>` is the current working directory for `local` scope. It is your home directory for `global` scope.

| Arg / option    | Default        | Description                                                                    |
| --------------- | -------------- | ------------------------------------------------------------------------------ |
| `--scope`       | (prompt)       | `local` (`<cwd>/.agents/skills`) or `global` (`~/.agents/skills`)              |
| `--with-gh`     | (prompt)       | Include a "fetch logs from GitHub via `gh`" section                            |
| `--gh-base-url` | (prompt if gh) | GitHub Enterprise host (for example, `github.example.com`). Blank = github.com |
| `--gh-repo`     | (prompt if gh) | Repository as `org/repo` (for example, `acme/app`)                             |
| `--gh-workflow` | (prompt if gh) | Filename of the workflow that runs Renovate (for example, `renovate.yml`)      |
| `--yes`         | `false`        | Skip all prompts. Fail if a required answer is missing                         |

**Exit codes:** `0` = success · `2` = tool/usage error (missing required answer without prompts, or a write failure).

### `web`

This command starts the bundled web UI for interactive, filtered log analysis. The UI is a statically rendered [Nuxt](https://nuxt.com) SPA with [Nuxt UI](https://ui.nuxt.com).

A small [Express](https://expressjs.com) server provides the UI and exposes the `/api` endpoints. The server keeps the SQLite-backed parsed log on disk. It streams paged rows to the client.

To open a log automatically, provide its optional path. Otherwise, use the file picker in the UI.

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

**The viewer** displays every log line in a virtualized list with a fixed height. Each row shows a colored level glyph (`T/D/I/W/E/F`) and the entry `msg`.

The arrow in each row opens the details slide-over. The slide-over contains a recursive, collapsible JSON tree of the complete entry.

**Filtering**: The UI combines all filters with AND logic and debounces input.

- **Log levels**: a dropdown that shows or hides entries by level.
- **Repositories**: includes or excludes entries by repository. The "Repository-independent" pseudo-group contains entries without a `repository`.
- **Ignored fields**: hides noisy root keys from the row list. The UI always keeps `msg`.
- **Free-text search**: a field selector. Its first entry, **Raw search**, matches any key or value in the complete line. Other fields use a case-insensitive `*` wildcard match in that field.
- **Pills**: dynamic filters from the context menus for rows and JSON trees. You can enable, disable, or remove each filter. For example, show or hide a `field` or a `field == value`. Nested keys create a scoped "contains" search for their top-level ancestor.

The UI help explains controls that are not visually apparent. These controls include context menus, pill behavior, search rules, and hidden fields.

Select the **Help** button in the header to read this information.

## Development

This repository is an npm workspace. The publishable CLI and Express web server are in the root `src/` directory. The Nuxt frontend is in [`web/`](./web).

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

Three suites detect different failure classes:

- **Unit tests** (`src/core/__tests__/*.test.ts`): These tests use synthetic, manually written JSONL logs. Each log tests one detection contract.
- **Fixture tests** (`src/core/__tests__/fixtures.test.ts`): The complete Parser → ErrorDetector/Analyzer pipeline runs on _real_ Renovate logs. Most come from [`MShekow/renovate-log-parser-test`](https://github.com/MShekow/renovate-log-parser-test). The repository stores them in `src/core/__tests__/fixtures/`:

  | Fixture                       | What it demonstrates                                                                                                                                                 |
  | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `external-host-error.jsonl`   | NPM registry blocked → the run aborts with `result: "external-host-error"`                                                                                           |
  | `various-issues.jsonl`        | Abandoned packages, a required configuration migration, and an npm `lock file error` whose `err.stderr` reports a `Conflicting peer dependency`                      |
  | `failed-dotnet-install.jsonl` | `builds.dotnet.microsoft.com` blocked → `Datasource connection error` (`DEPTH_ZERO_SELF_SIGNED_CERT`) and `Failed to generate lock file` / "No tool releases found." |
  | `invalid-config.jsonl`        | An unparseable `renovate.jsonc` → `Repository has invalid config` at warning level, and `result: "config-validation"`                                                |

  The `invalid-config` fixture is the exception: Renovate ran with `--platform=local` against a directory, so there is no test repository and the repository is named `local`. Its input is `src/core/__tests__/fixtures/invalid-config-repo/renovate.jsonc`, which is malformed on purpose. Do not reformat that file. It is listed in `.prettierignore`.

  The assertions are _semantic_, not snapshot-based. A Renovate log contains variable data, such as timestamps, pid, hostname, logContext, and dependency versions. The assertions cover only the signals that each scenario demonstrates.

- **Packaging E2E tests** (`e2e/pack-install.e2e.ts`): These tests build and run `npm pack`. They install the tarball in an empty temporary project. Then they run the installed `renovate-log-parser` binary with a fixture. Only this suite detects a missing `package.json#files` entry. When `src/` is adjacent, it also detects a `dist/` import that resolves only in that location.

  To skip the packaging tests, set `SKIP_E2E=1`.

  The nested `web UI` block starts the installed `web` command. It controls the real UI in headless Chromium with the `playwright-core` _library_. There is no second test runner or configuration file. The cases use `node:test` in the same file. The cases prove that the shipped server starts and provides the SPA. They do not only inspect the package files.

  If a browser test fails, the suite writes a screenshot and HTML dump to `e2e-artifacts/`. It also writes the captured console and server output. CI uploads these files as a build artifact.

### Screenshot tests

There are cases in the `web UI` block comparing the live UI with PNG files in [`e2e/screenshots/`](./e2e/screenshots). These files show the empty state, a loaded log, the Problems slide-over, and the details slide-over.

A difference in **one** pixel fails the test. Locator-based assertions cannot detect a broken layout or a level glyph that lost its color. They also cannot detect a Nuxt UI upgrade that changes the header layout. Only this suite detects these changes.

Code is not the only factor that changes pixels. The Chromium build, installed font files, and fontconfig rasterization configuration also change the output.

A baseline is meaningful only in a fixed environment. Therefore, the comparison runs in the container built from [`e2e/Dockerfile`](./e2e/Dockerfile). The container has a pinned base image and a fixed grayscale antialiasing and hinting configuration. The `playwright-core` version in `package.json` pins the Chromium build.

Outside this container, the four cases skip. Therefore, `npm run test:e2e` continues to work as before.

```bash
npm run test:e2e:screenshots         # build the image, run the suite, compare
npm run test:e2e:screenshots:update  # same, but rewrite the baselines
```

Both commands build the image, which is cached after the first run. They mount the work tree with your UID. Therefore, they do not leave root-owned files on the host.

If the images differ, the commands write the expected, actual, and difference images to `e2e-artifacts/`. CI uploads these images.

After an intentional UI change, run the update script. Then **inspect the regenerated PNGs**. Commit them with the change.

A baseline difference is part of the review. Do not approve it without inspection.

After an upgrade of `@nuxt/ui`, `tailwindcss`, or `playwright-core`, update and inspect the screenshot baselines. All three products may change pixels.

For consistent output, the project hosts `Public Sans` with `@fontsource/public-sans` instead of only declaring the font.

### Regenerating the log fixtures

The [`compose.yml`](./compose.yml) stack runs Renovate against the test repository. It includes an NGINX "firewall" for selected hostnames.

Docker DNS points these hostnames to the firewall. Therefore, outbound access to these hostnames fails as it does behind a corporate proxy.

The base file does not block a hostname. Each scenario adds an override with the hostnames that it must block:

```bash
# Requires a .env with GITHUB_PAT (+ optionally LOCAL_UID / LOCAL_GID)
docker compose -f compose.yml up -d                                         # various-issues
docker compose -f compose.yml -f compose.external-host-error.yml up -d      # external-host-error
docker compose -f compose.yml -f compose.failed-dotnet-install.yml up -d    # failed-dotnet-install

docker compose ... wait renovate        # block until Renovate exits
cp container-out-logs/out.log src/core/__tests__/fixtures/<scenario>.jsonl
docker compose ... down -v              # discard the generated certificate
```

Renovate must start from a _pristine_ repository. Remaining `renovate/*` branches cause the "Branch already exists" code path. That code path skips the work that the fixture records. Before you regenerate a fixture, close the related Renovate PRs and delete their branches.

The `invalid-config` fixture does not use this stack. It runs Renovate's [local platform](https://docs.renovatebot.com/modules/platform/local) against a directory, so it needs no test repository, no token and no firewall:

```bash
work="$(mktemp -d)"                     # must be outside a Git work tree
cp src/core/__tests__/fixtures/invalid-config-repo/renovate.jsonc "$work/"
chmod -R a+rwX "$work"
mkdir -p container-out-logs && chmod 777 container-out-logs
: > container-out-logs/out.log && chmod 666 container-out-logs/out.log

docker run --rm -v "$work":/workspace -w /workspace \
  -v "$PWD/container-out-logs":/logs \
  -e LOG_LEVEL=debug -e LOG_FILE=/logs/out.log -e RENOVATE_PLATFORM=local \
  --entrypoint renovate renovate/renovate:latest

cp container-out-logs/out.log src/core/__tests__/fixtures/invalid-config.jsonl
```

Two details matter here. The scratch directory must be outside a Git work tree, because Renovate lists files with `git ls-files` and only falls back to a glob when that command fails. Inside a work tree it succeeds and returns the wrong files. The log file must also be created in advance and made writable, because `--entrypoint renovate` skips the wrapper that normally returns ownership of the log to your user.

The [`.github/workflows/verify-fixtures.yml`](./.github/workflows/verify-fixtures.yml) workflow automates this process each week and on demand. It uses one job for each scenario.

The jobs that share the test repository run in sequence. Each of these jobs first closes every Renovate PR and deletes every Renovate branch. The `invalid-config` job uses no repository, so it runs in parallel.

The workflow overwrites the committed fixture with the new log. Then it runs the fixture tests with this log.

If a Renovate release renames a message or removes a field, the workflow fails. It does not commit the new log.

Instead, the workflow uploads the log as an artifact for an intentional fixture update. The workflow requires a `TEST_REPO_PAT` secret.

This secret is a fine-grained PAT. It requires write access to contents and pull requests in the test repository.

### Linting & formatting

[ESLint](https://eslint.org) uses a flat configuration at the workspace root. [Prettier](https://prettier.io) also has its configuration at the workspace root.

```bash
npm run lint          # ESLint for src/ (type-aware) + web/ (Nuxt rules)
npm run format        # Prettier write pass over all non-ignored files
npm run format:check  # Prettier check (no writes — useful in CI)
```

- **Root (`src/`)**: [`eslint.config.mjs`](./eslint.config.mjs) applies the `typescript-eslint` `recommendedTypeChecked` rules to `src/**/*.ts`. It appends `eslint-config-prettier` to disable rules that conflict with Prettier. Prettier uses its defaults: semicolons, double quotes, and trailing commas.
- **Web (`web/`)**: [`web/eslint.config.mjs`](./web/eslint.config.mjs) uses the generated `@nuxt/eslint` configuration. This configuration covers Vue, TypeScript, and Nuxt-specific rules. The root ESLint and Prettier configurations exclude `web/`. Therefore, the two configurations remain independent.

### How it is built

- **CLI**: TypeScript compiles to ESM in `dist/` with `tsc`. The CLI uses [`yargs`](https://yargs.js.org) to parse commands.
- **Frontend**: The Nuxt UI application uses `nuxt generate` and `ssr: false`. It is a client-side SPA. The `web/.output/public` directory contains an application shell and static assets. The package does not include Nitro/h3, and the application does not run it. The frontend shares the filtering model and level metadata from `src/core/` with the CLI. The bundle aliases this code as `renovate-core`.

  Therefore, the browser and CLI use the same SQLite-backed model.

- **Backend**: A plain Express server is in [`src/server/`](./src/server). The same `tsc` pass compiles the backend and CLI. The backend imports `src/core/` through ordinary relative imports without a bundler or alias. It provides the `/api` routes from `api.ts`. It also provides the static SPA with an `index.html` fallback for client-side routing. `log-registry.ts` holds the process-wide "current log".

  It keeps one open `Parser`/SQLite handle for each loaded md5 and a memoized error report. The `web` command starts `dist/server/server-main.js` as a child process. When the user provides a log path, the command sends it to the UI in a `?log=` query parameter.

### What gets published

Two `package.json` mechanisms include both build outputs in the npm package:

- **`files: ["dist", "web/.output/public"]`**: This allow-list controls the contents of the published tarball. npm always adds `package.json`, `README`, `LICENSE`, and the `bin` target. Then it recursively adds both listed directories. This list takes precedence over `.gitignore`. Therefore, npm publishes `web/.output/` although Git ignores it as a build artifact.
- **`prepublishOnly: "npm run build"`**: Before npm creates the package for `npm publish`, it automatically runs this lifecycle hook. The hook generates the static SPA and compiles the CLI and server to `dist`. When npm evaluates the `files` allow-list, both directories exist and contain current files.

```
npm publish
  └─ prepublishOnly → npm run build → build:web (nuxt generate → web/.output/public/)
                                    → build:cli (tsc           → dist/)
  └─ pack tarball using `files`: dist/ + web/.output/public/ (+ package.json, README, LICENSE)
  └─ upload to registry
```

The result is a small, self-contained package. It does not include source files or an unintended `node_modules` directory.

Run `npm pack --dry-run` to inspect the package contents.

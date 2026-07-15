# renovate-log-parser

A CLI that parses Renovate Bot debug logs to auto-detect issues in scheduled Renovate runs, or interactively diagnose issues with your coding agent, or manually via web UI.

## Usage

Run directly with `npx` (no install required):

```bash
# Basic error detection (currently a stub — prints "hello world")
npx renovate-log-parser detect-errors

# Optionally pass a log file (not yet parsed)
npx renovate-log-parser detect-errors path/to/renovate.log

# Start the Nuxt-based web UI
npx renovate-log-parser web
```

Or install globally:

```bash
npm install -g renovate-log-parser
renovate-log-parser --help
```

## Commands

### `detect-errors [file]`

Placeholder for the log-parsing feature. Performs basic I/O today; future
versions will analyse a Renovate debug log and report detected issues.

### `web`

Starts the bundled [Nuxt](https://nuxt.com) web UI (with [Nuxt UI](https://ui.nuxt.com)
and Nuxt's built-in Nitro server). The demo page is server-rendered and fetches
live data from the `/api/hello` Nitro route.

| Option     | Default     | Description                        |
| ---------- | ----------- | ---------------------------------- |
| `--port`   | `3000`      | Port to listen on                  |
| `--host`   | `localhost` | Host to bind to                    |
| `--open`   | `true`      | Open the web UI in your browser    |

```bash
renovate-log-parser web --port 4000 --no-open
```

## Development

This repository is an npm workspace: the publishable CLI lives at the root and
the Nuxt app lives in [`web/`](./web).

```bash
# Install all workspace dependencies
npm install

# Run the CLI from source (no build step) via tsx
npm run dev:cli -- detect-errors
npm run dev:cli -- web

# Run the Nuxt app in dev mode (HMR) directly
npm run dev:web

# Build everything (Nuxt .output + compiled CLI)
npm run build

# Run the compiled CLI
node dist/cli.js --help
```

### How it's built

- **CLI** — TypeScript compiled with `tsc` to ESM in `dist/`. Uses
  [`yargs`](https://yargs.js.org) for command parsing. `yargs` is the only
  runtime dependency.
- **Web** — scaffolded with `npm create nuxt@latest` (Nuxt UI template) and
  built with `nuxt build`. The command runs the self-contained Nitro server
  (`web/.output/server/index.mjs`) as a child process.

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

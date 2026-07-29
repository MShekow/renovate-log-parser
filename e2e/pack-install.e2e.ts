/**
 * End-to-end packaging tests.
 *
 * These do *not* test detection logic — the unit and fixture tests own that.
 * They test that the published artifact works: that `npm pack` produces a
 * tarball which, installed into an empty project on a clean machine, exposes a
 * working `renovate-log-parser` binary.
 *
 * That is a distinct failure class from anything the other suites can catch.
 * A missing entry in `package.json#files`, a `dist/` import that resolves only
 * because `src/` happens to sit next to it, a Nuxt `.output` symlink that npm
 * silently drops — all of those pass every in-repo test and break for the first
 * person who installs the package.
 *
 * The suite builds, packs, and installs exactly once (in `before`), then runs
 * the CLI against a committed fixture. `web` is deliberately out of scope for
 * now; only the presence of its build output is asserted.
 *
 * Run with `npm run test:e2e` (not part of `npm test` — the Nuxt build makes it
 * slow). Set `SKIP_E2E=1` to skip.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Repository root (this file lives in `<root>/e2e`). */
const REPO_ROOT = resolve(import.meta.dirname, "..");

/** The fixture the CLI is exercised against. */
const FIXTURE = resolve(
  REPO_ROOT,
  "src/core/__tests__/fixtures/various-issues.jsonl",
);

/** Build + pack + install is minutes of work on a cold cache. */
const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
const CLI_TIMEOUT_MS = 2 * 60 * 1000;

/** Result of running a command. */
interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run a command, returning its captured output instead of throwing. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout = CLI_TIMEOUT_MS,
): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    timeout,
    encoding: "utf8",
    // Keep npm quiet and non-interactive, and make sure a stray user config
    // (e.g. a private registry) cannot influence the install.
    env: {
      ...process.env,
      npm_config_fund: "false",
      npm_config_audit: "false",
    },
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error.message}`,
    );
  }
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Run a command and fail the suite if it exits non-zero. */
function runOrThrow(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout = CLI_TIMEOUT_MS,
): RunResult {
  const result = run(command, args, cwd, timeout);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return result;
}

describe("packaged CLI", { skip: process.env.SKIP_E2E === "1" }, () => {
  /** The throwaway project the tarball gets installed into. */
  let projectDir: string;
  /** Absolute path to the installed `renovate-log-parser` binary. */
  let cli: string;
  /** The fixture, copied next to the installed package. */
  let fixture: string;

  /** Run the installed CLI from inside the throwaway project. */
  const cliRun = (...args: string[]): RunResult => run(cli, args, projectDir);

  before(() => {
    // 1. Build the publishable output (CLI + Nuxt web bundle).
    runOrThrow("npm", ["run", "build"], REPO_ROOT, SETUP_TIMEOUT_MS);

    // 2. Pack. The tarball name embeds the version, so read it from npm's
    //    output rather than hardcoding it.
    projectDir = mkdtempSync(join(tmpdir(), "rlp-e2e-"));
    const packed = runOrThrow(
      "npm",
      ["pack", "--pack-destination", projectDir],
      REPO_ROOT,
      SETUP_TIMEOUT_MS,
    );
    const tarballName = packed.stdout.trim().split("\n").filter(Boolean).at(-1);
    assert.ok(tarballName, "npm pack printed no tarball name");
    const tarball = join(projectDir, tarballName.trim());
    assert.ok(existsSync(tarball), `tarball not found at ${tarball}`);

    // 3. Install into an otherwise empty project — no workspace, no hoisted
    //    dependencies from the repo, nothing but what the tarball ships.
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "rlp-e2e-consumer",
          version: "0.0.0",
          private: true,
          type: "module",
        },
        null,
        2,
      ) + "\n",
    );
    runOrThrow(
      "npm",
      ["install", tarball, "--no-audit", "--no-fund"],
      projectDir,
      SETUP_TIMEOUT_MS,
    );

    cli = join(projectDir, "node_modules", ".bin", "renovate-log-parser");
    fixture = join(projectDir, "various-issues.jsonl");
    copyFileSync(FIXTURE, fixture);
  });

  after(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("installs an executable bin and ships the web build output", () => {
    assert.ok(existsSync(cli), `missing bin at ${cli}`);

    const pkgRoot = join(projectDir, "node_modules", "renovate-log-parser");
    assert.ok(
      existsSync(join(pkgRoot, "dist", "cli.js")),
      "dist/cli.js is missing from the tarball",
    );
    // Guards `package.json#files` and scripts/deref-output-symlinks.mjs: npm
    // does not follow symlinks into a tarball, so a regression here ships an
    // empty web bundle that only shows up when someone runs `web`.
    assert.ok(
      existsSync(join(pkgRoot, "web", ".output", "server", "index.mjs")),
      "web/.output/server/index.mjs is missing from the tarball",
    );
  });

  test("--help lists every command", () => {
    const result = cliRun("--help");
    assert.equal(result.status, 0, result.stderr);
    for (const command of ["detect-errors", "analyze", "web"]) {
      assert.match(result.stdout, new RegExp(command));
    }
  });

  test("detect-errors reports findings and exits 1", () => {
    const reportPath = join(projectDir, "report.json");
    const result = cliRun("detect-errors", fixture, "--out", reportPath);

    assert.equal(result.status, 1, `expected exit 1\n${result.stderr}`);
    assert.match(result.stdout, /Errors:/);
    assert.match(result.stdout, /abandoned-package/);

    const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.ok(report !== null && typeof report === "object");
    const typed = report as {
      version: number;
      counts: Record<string, number>;
      findings: unknown[];
    };
    assert.equal(typed.version, 1);
    assert.ok(typed.counts["abandoned-package"] >= 3);
    assert.ok(typed.findings.length > 0);
  });

  test("detect-errors --fail-on-warn still exits 1", () => {
    const result = cliRun("detect-errors", fixture, "--fail-on-warn");
    assert.equal(result.status, 1, result.stderr);
  });

  test("detect-errors exits 2 on a missing log", () => {
    const result = cliRun("detect-errors", join(projectDir, "nope.jsonl"));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /detect-errors:/);
  });

  test("analyze emits compact single-line JSON stats", () => {
    const result = cliRun("analyze", fixture);
    assert.equal(result.status, 0, result.stderr);

    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.length, 1, "stats output must be a single line");

    const stats = JSON.parse(lines[0]) as {
      totalLines: number;
      levelCounts: Record<string, number>;
      repos: { name: string }[];
    };
    assert.ok(stats.totalLines > 100);
    assert.ok(Object.keys(stats.levelCounts).length > 0);
    assert.ok(
      stats.repos.some((r) => r.name === "MShekow/renovate-log-parser-test"),
    );
  });

  test("analyze --print streams limited JSONL to stdout", () => {
    const result = cliRun("analyze", fixture, "--print", "--limit", "5");
    assert.equal(result.status, 0, result.stderr);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    assert.ok(
      lines.length > 0 && lines.length <= 5,
      `got ${lines.length} lines`,
    );
    // stdout must stay pipeable: every line is a standalone JSON object, with
    // truncation notices routed to stderr.
    for (const line of lines) {
      assert.equal(typeof JSON.parse(line), "object");
    }
  });
});

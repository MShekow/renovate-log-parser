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
 * the CLI against a committed fixture. The nested "web UI" block additionally
 * starts the installed `web` command and drives the real UI in a headless
 * Chromium via the `playwright-core` library — no second test runner, these are
 * plain `node:test` cases like the rest of the file.
 *
 * Run with `npm run test:e2e` (not part of `npm test` — the Nuxt build makes it
 * slow). Set `SKIP_E2E=1` to skip. The browser tests need Chromium installed
 * once via `npx playwright-core install chromium`; screenshots and page dumps
 * for failing browser tests are written to `<root>/e2e-artifacts`.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";

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

  /**
   * Browser-level tests for the `web` command.
   *
   * Nested inside `packaged CLI` on purpose: the outer `before` has already
   * built, packed and installed the tarball, so these drive the *published*
   * web bundle rather than the repo's build tree. That upgrades the "the
   * `.output` files exist" assertion above into "the bundle actually boots and
   * serves a working UI" — which is where the `renovate-core` alias inlining
   * and the Nitro build would break.
   *
   * The URL used here (`/?log=<absolute path>`) is exactly the one the CLI
   * itself hands to the browser when invoked as `web <path>`.
   */
  describe("web UI", () => {
    /** Where screenshots/HTML dumps of failing browser tests are written. */
    const ARTIFACT_DIR = join(REPO_ROOT, "e2e-artifacts");
    /** Booting Nitro and loading the fixture is slower than a CLI invocation. */
    const WEB_TEST_TIMEOUT_MS = 60 * 1000;

    let server: ChildProcess | undefined;
    let browser: Browser | undefined;
    let page: Page | undefined;
    let baseUrl: string;
    /** Everything the CLI + Nitro wrote, for failure diagnostics. */
    let serverOutput = "";
    /** Browser console messages, reset per test, for failure diagnostics. */
    let consoleMessages: string[] = [];

    /** Ask the OS for a free port so a busy 3000 cannot break the suite. */
    const freePort = async (): Promise<number> =>
      new Promise((resolvePort, reject) => {
        const probe = createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          const address = probe.address();
          if (address === null || typeof address === "string") {
            reject(new Error("could not determine a free port"));
            return;
          }
          const { port } = address;
          probe.close(() => resolvePort(port));
        });
      });

    /** Poll the server until it answers, so tests never race the Nitro boot. */
    const waitForServer = async (url: string, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try {
          const response = await fetch(url);
          if (response.ok) return;
        } catch {
          // Not listening yet.
        }
        if (Date.now() > deadline) {
          throw new Error(
            `web server did not become ready within ${timeoutMs}ms\n` +
              `--- server output ---\n${serverOutput}`,
          );
        }
        await delay(250);
      }
    };

    before(async () => {
      const port = await freePort();
      baseUrl = `http://127.0.0.1:${port}`;

      // `--no-open` is essential: `--open` defaults to true and would spawn a
      // real browser (xdg-open/open) on the machine running the tests.
      server = spawn(
        cli,
        [
          "web",
          "--no-open",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          // Deliberately no log path — each test navigates to `?log=` itself.
        ],
        { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] },
      );
      server.stdout?.on("data", (chunk: Buffer) => {
        serverOutput += chunk.toString();
      });
      server.stderr?.on("data", (chunk: Buffer) => {
        serverOutput += chunk.toString();
      });

      await waitForServer(`${baseUrl}/`, CLI_TIMEOUT_MS);
      assert.match(
        serverOutput,
        new RegExp(`Starting renovate-log-parser web UI on ${baseUrl}`),
        "the web command did not announce its base URL",
      );

      try {
        browser = await chromium.launch({
          // GitHub runners and containers are happier without the sandbox; the
          // only content loaded is our own localhost server.
          args: process.env.CI ? ["--no-sandbox"] : [],
        });
      } catch (error) {
        throw new Error(
          "could not launch Chromium — install it once with " +
            "`npx playwright-core install chromium`",
          { cause: error },
        );
      }
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on("console", (message) => {
        consoleMessages.push(`[${message.type()}] ${message.text()}`);
      });
    });

    after(async () => {
      // Guarded individually: a failure in `before` must not leak a browser or
      // a server process into CI.
      if (browser) await browser.close();
      if (server && server.exitCode === null) {
        const exited = new Promise<void>((resolveExit) =>
          server?.once("exit", () => resolveExit()),
        );
        // The CLI forwards SIGTERM to its Nitro child, so this also exercises
        // the shutdown path in src/commands/web.ts.
        server.kill("SIGTERM");
        await Promise.race([exited, delay(10_000)]);
        if (server.exitCode === null) server.kill("SIGKILL");
      }
    });

    /**
     * Define a browser test that dumps a screenshot, the rendered HTML and the
     * captured console output to `e2e-artifacts/` before rethrowing. Without a
     * Playwright runner there is no trace viewer, so this is the only forensic
     * trail a CI failure leaves behind.
     */
    const webTest = (name: string, body: (page: Page) => Promise<void>) => {
      test(name, { timeout: WEB_TEST_TIMEOUT_MS }, async () => {
        assert.ok(page, "browser page was not created");
        consoleMessages = [];
        try {
          await body(page);
        } catch (error) {
          const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
          try {
            mkdirSync(ARTIFACT_DIR, { recursive: true });
            await page.screenshot({
              path: join(ARTIFACT_DIR, `${slug}.png`),
              fullPage: true,
            });
            writeFileSync(
              join(ARTIFACT_DIR, `${slug}.html`),
              await page.content(),
            );
            writeFileSync(
              join(ARTIFACT_DIR, `${slug}.log`),
              `--- browser console ---\n${consoleMessages.join("\n")}\n` +
                `--- server output ---\n${serverOutput}\n`,
            );
          } catch (captureError) {
            console.error("failed to capture artifacts:", captureError);
          }
          throw error;
        }
      });
    };

    /** The URL the CLI opens for `renovate-log-parser web <path>`. */
    const logUrl = () => `${baseUrl}/?log=${encodeURIComponent(fixture)}`;

    webTest("loads the log handed over via ?log= and renders it", async (p) => {
      await p.goto(logUrl());

      // Header shows the loaded path: proves the frontend read `?log=` and the
      // server accepted POST /api/log/path.
      await p.getByText(fixture, { exact: true }).waitFor();
      await p.getByText(/[\d,]+ lines/).waitFor();

      // Rows come from GET /api/rows and are virtualized, so the first one
      // appearing means the whole read path works end to end.
      const rows = p.getByTestId("log-row");
      await rows.first().waitFor();
      assert.ok(await rows.count(), "no log rows were rendered");
      const firstRow = (await rows.first().innerText()).trim();
      assert.ok(firstRow.length > 0, "the first log row rendered empty");

      // The empty state must be gone once a log is loaded.
      assert.equal(
        await p.getByText("Open a Renovate JSONL log to begin.").count(),
        0,
        "the empty state is still showing after loading a log",
      );
    });

    webTest("lists findings and jumps to the source line", async (p) => {
      await p.goto(logUrl());
      await p.getByText(fixture, { exact: true }).waitFor();

      await p.getByRole("button", { name: /Problems/ }).click();

      const dialog = p.getByRole("dialog");
      await dialog.waitFor();
      const items = dialog.getByTestId("finding-item");
      await items.first().waitFor();
      // The same fixture yields >= 3 `abandoned-package` findings via the CLI
      // (asserted above), so the UI must not come up empty either.
      assert.ok(
        (await items.count()) >= 3,
        "the Problems panel listed fewer findings than the CLI reports",
      );

      // Clicking a finding closes the panel and jumps to its source line,
      // which flashes the target row via the `highlighted` prop.
      await items.first().click();
      await p.locator(".log-row--highlight").waitFor();
    });
  });
});

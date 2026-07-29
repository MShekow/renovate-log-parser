/**
 * Fixture-based tests against *real* Renovate logs.
 *
 * Unlike the synthetic tests in `error-detector.test.ts`, these run the full
 * Parser → ErrorDetector / Analyzer pipeline over committed logs captured from
 * actual Renovate runs against `MShekow/renovate-log-parser-test`
 * (see `.github/workflows/verify-fixtures.yml`, which regenerates them).
 *
 * Assertions are deliberately *semantic*, never snapshot-based: a Renovate log
 * is full of volatile data (timestamps, pid, hostname, logContext, dependency
 * versions, abandoned-package dates). We assert only the signals each scenario
 * was captured to demonstrate, so the tests survive routine Renovate churn but
 * still fail loudly if a detection contract regresses — in either direction:
 * a code change that stops detecting, or a Renovate change that stops emitting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Parser } from "../parser.js";
import { ErrorDetector, type DetectionReport } from "../error-detector.js";
import { Analyzer } from "../analyzer.js";

/** The repository every fixture was captured against. */
const TEST_REPOSITORY = "MShekow/renovate-log-parser-test";

/** Fixture names (also the file basenames and the CI job/scenario names). */
const FIXTURES = [
  "external-host-error",
  "various-issues",
  "failed-dotnet-install",
] as const;

type FixtureName = (typeof FIXTURES)[number];

/** A parsed log entry (Renovate emits many optional fields). */
type LogEntry = Record<string, unknown>;

/** Absolute path of a fixture log. */
function fixturePath(name: FixtureName): string {
  return join(import.meta.dirname, "fixtures", `${name}.jsonl`);
}

/**
 * Load a fixture, hand the open Parser to `fn`, and always close it.
 * Each call re-uses the on-disk SQLite cache keyed by the file's md5, so
 * repeated loads of an unchanged fixture are cheap.
 */
function withFixture<T>(name: FixtureName, fn: (parser: Parser) => T): T {
  const parser = new Parser();
  try {
    parser.load(fixturePath(name));
    return fn(parser);
  } finally {
    parser.close();
  }
}

/** Run error detection over a fixture. */
function detect(name: FixtureName): DetectionReport {
  return withFixture(name, (parser) => new ErrorDetector(parser).run());
}

/** Every entry of a fixture, in line order (fixtures are <1k lines). */
function allEntries(parser: Parser): { line: number; entry: LogEntry }[] {
  return parser.queryEntries<LogEntry>(
    "SELECT line, logentry FROM logs ORDER BY line ASC",
  );
}

/** Find the single entry matching `predicate`; fails the test if absent. */
function findEntry(
  parser: Parser,
  description: string,
  predicate: (entry: LogEntry) => boolean,
): { line: number; entry: LogEntry } {
  const match = allEntries(parser).find(({ entry }) => predicate(entry));
  assert.ok(match !== undefined, `expected a log entry: ${description}`);
  return match;
}

/** Read a string field off an `err`-shaped object (`""` when missing). */
function errField(err: unknown, field: string): string {
  if (err === null || typeof err !== "object" || Array.isArray(err)) return "";
  const value = (err as LogEntry)[field];
  return typeof value === "string" ? value : "";
}

/** Read a string field off an entry's root-level `err` object. */
function errString(entry: LogEntry, field: string): string {
  return errField(entry.err, field);
}

// ---------------------------------------------------------------------------
// Shared invariants
// ---------------------------------------------------------------------------

for (const name of FIXTURES) {
  test(`${name}: fixture is a well-formed, non-truncated Renovate log`, () => {
    withFixture(name, (parser) => {
      const loaded = parser.loaded;
      assert.ok(loaded !== undefined);
      assert.ok(
        loaded.totalLines > 100,
        `fixture looks truncated (${loaded.totalLines} lines)`,
      );

      // A regenerated log that got copied while Renovate was still writing, or
      // that picked up non-JSON output, would surface here rather than as a
      // confusing downstream assertion failure.
      const broken = allEntries(parser).filter(
        ({ entry }) => entry._parseError === true || entry._blank === true,
      );
      assert.deepEqual(
        broken.map(({ line }) => line),
        [],
        "fixture contains blank or unparseable lines",
      );
    });
  });

  test(`${name}: analyzer reports the test repository`, () => {
    withFixture(name, (parser) => {
      const stats = new Analyzer(parser).stats();
      assert.ok(
        Object.keys(stats.levelCounts).length > 0,
        "expected per-level counts",
      );
      const repo = stats.repos.find((r) => r.name === TEST_REPOSITORY);
      assert.ok(repo !== undefined, `expected stats for ${TEST_REPOSITORY}`);
      assert.ok(repo.toLine >= repo.fromLine);

      // The stats payload is emitted as compact single-line JSON by the
      // `analyze` command, so it must be serialisable without cycles.
      assert.ok(JSON.stringify(stats).length > 0);
    });
  });

  test(`${name}: config migration is detected`, () => {
    const report = detect(name);
    const migrations = report.findings.filter(
      (f) => f.category === "config-migration",
    );
    assert.ok(
      migrations.length >= 1,
      "expected at least one config-migration finding",
    );
    assert.equal(migrations[0].repository, TEST_REPOSITORY);
    assert.equal(report.exitCode, 1, "config migration alone must exit 1");
  });
}

// ---------------------------------------------------------------------------
// external-host-error — NPM registry blocked by the firewall
// ---------------------------------------------------------------------------

test("external-host-error: repository run aborts with an external host error", () => {
  const report = detect("external-host-error");
  const aborts = report.findings.filter(
    (f) => f.category === "host-error-abort",
  );
  assert.equal(aborts.length, 1);
  assert.equal(aborts[0].severity, "error");
  assert.equal(aborts[0].repository, TEST_REPOSITORY);
  assert.deepEqual(aborts[0].details, { result: "external-host-error" });
  assert.equal(report.counts["host-error-abort"], 1);
});

test("external-host-error: the abort is backed by a 'Repository finished' entry", () => {
  withFixture("external-host-error", (parser) => {
    const { entry } = findEntry(
      parser,
      'msg="Repository finished" with result="external-host-error"',
      (e) => e.msg === "Repository finished",
    );
    assert.equal(entry.result, "external-host-error");
    assert.equal(entry.repository, TEST_REPOSITORY);
  });
});

// ---------------------------------------------------------------------------
// various-issues — abandoned packages, config migration, peer-dependency
// conflict while regenerating package-lock.json
// ---------------------------------------------------------------------------

test("various-issues: at least three abandoned packages are detected", () => {
  const report = detect("various-issues");
  const abandoned = report.findings.filter(
    (f) => f.category === "abandoned-package",
  );
  assert.ok(
    abandoned.length >= 3,
    `expected >= 3 abandoned packages, got ${abandoned.length}`,
  );
  assert.equal(report.counts["abandoned-package"], abandoned.length);

  // Each finding is a distinct `datasource:package` pair carrying its own
  // last-updated timestamp.
  const messages = new Set(abandoned.map((f) => f.message));
  assert.equal(
    messages.size,
    abandoned.length,
    "abandoned packages must be unique",
  );
  for (const finding of abandoned) {
    assert.match(finding.message, /^[^:]+:.+$/);
    assert.equal(finding.severity, "error");
    assert.equal(typeof finding.details?.datasource, "string");
    assert.equal(typeof finding.details?.package, "string");
    assert.equal(typeof finding.details?.lastUpdated, "string");
  }
});

test("various-issues: npm lock file error caused by a conflicting peer dependency", () => {
  withFixture("various-issues", (parser) => {
    const { line, entry } = findEntry(
      parser,
      'msg="lock file error" on branch renovate/major-eslint-monorepo',
      (e) =>
        e.msg === "lock file error" &&
        e.branch === "renovate/major-eslint-monorepo",
    );
    assert.match(errString(entry, "stderr"), /Conflicting peer dependency/);

    // The entry itself is level 20 (debug) — Renovate buries it — so the only
    // way it surfaces is via the `err-object` category. This is precisely the
    // class of problem the detector exists to expose.
    const report = new ErrorDetector(parser).run();
    const finding = report.findings.find(
      (f) => f.category === "err-object" && f.line === line,
    );
    assert.ok(
      finding !== undefined,
      "expected an err-object finding for the lock file error",
    );
    assert.equal(finding.severity, "warning");
    assert.equal(finding.repository, TEST_REPOSITORY);
    assert.match(
      errField(finding.details?.err, "stderr"),
      /Conflicting peer dependency/,
    );
  });
});

// ---------------------------------------------------------------------------
// failed-dotnet-install — builds.dotnet.microsoft.com blocked by the firewall
// ---------------------------------------------------------------------------

test("failed-dotnet-install: lock file generation fails with 'No tool releases found.'", () => {
  withFixture("failed-dotnet-install", (parser) => {
    const { line, entry } = findEntry(
      parser,
      'msg="Failed to generate lock file" on branch renovate/newtonsoft.json-13.x',
      (e) =>
        e.msg === "Failed to generate lock file" &&
        e.branch === "renovate/newtonsoft.json-13.x",
    );
    assert.equal(errString(entry, "message"), "No tool releases found.");

    const report = new ErrorDetector(parser).run();
    const finding = report.findings.find(
      (f) => f.category === "err-object" && f.line === line,
    );
    assert.ok(
      finding !== undefined,
      "expected an err-object finding for the failed lock file generation",
    );
    assert.equal(finding.repository, TEST_REPOSITORY);
  });
});

test("failed-dotnet-install: the dotnet-sdk datasource fails with a TLS interception error", () => {
  withFixture("failed-dotnet-install", (parser) => {
    const { entry } = findEntry(
      parser,
      'msg="Datasource connection error" for dotnet-sdk',
      (e) =>
        e.msg === "Datasource connection error" &&
        e.datasource === "dotnet-version" &&
        e.packageName === "dotnet-sdk",
    );
    assert.equal(entry.branch, "renovate/newtonsoft.json-13.x");
    // The firewall terminates TLS with its own self-signed certificate, which
    // Node rejects — this is the fingerprint of a blocked outbound host.
    assert.equal(entry.errCode, "DEPTH_ZERO_SELF_SIGNED_CERT");
  });
});

test("failed-dotnet-install: abandoned packages are still reported despite the tool failure", () => {
  const report = detect("failed-dotnet-install");
  assert.ok(
    report.counts["abandoned-package"] >= 3,
    `expected >= 3 abandoned packages, got ${report.counts["abandoned-package"]}`,
  );
});

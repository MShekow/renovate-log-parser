/**
 * ErrorDetector / ignore-file tests.
 *
 * STUB: Phase 2 scaffolding. These build tiny synthetic JSONL logs in a temp
 * dir (no committed real log — the sample is private, see
 * docs/renovate-log-parser-plan.md, Q25) and assert the core detection
 * contracts: category mapping, counts completeness, repo-problem de-dup,
 * ignore-rule matching, and exit codes. Flesh out with real fixtures later.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser } from "../parser.js";
import { ErrorDetector, CATEGORIES } from "../error-detector.js";
import { globToRegExp, matchIgnoreRule } from "../ignore-file.js";

function writeTempLog(lines: object[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "rlp-detect-"));
  const path = join(dir, "renovate.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { dir, path };
}

function detect(lines: object[]) {
  const { dir, path } = writeTempLog(lines);
  const parser = new Parser();
  try {
    parser.load(path);
    return new ErrorDetector(parser).run();
  } finally {
    parser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("counts include every known category with zeros", () => {
  const report = detect([{ level: 20, msg: "debug only" }]);
  for (const category of CATEGORIES) {
    assert.equal(typeof report.counts[category], "number");
  }
  assert.equal(report.summary.errorCount, 0);
  assert.equal(report.exitCode, 0);
});

test("level 50/60 and err objects are errors; level 40 is a warning", () => {
  const report = detect([
    { level: 50, msg: "boom", repository: "o/r" },
    { level: 60, msg: "fatal" },
    { level: 30, msg: "with err", err: { message: "lock file error" } },
    { level: 40, msg: "just a warning" },
  ]);
  assert.equal(report.counts["log-error"], 1);
  assert.equal(report.counts["log-fatal"], 1);
  assert.equal(report.counts["err-object"], 1);
  assert.equal(report.counts["warn-log"], 1);
  assert.equal(report.summary.errorCount, 3);
  assert.equal(report.summary.warningCount, 1);
  assert.equal(report.exitCode, 1);
});

test("host-error-abort matches the exact message", () => {
  const report = detect([
    { level: 40, msg: "External host error causing abort" },
  ]);
  assert.equal(report.counts["host-error-abort"], 1);
});

test("repoProblems are de-duped against overlapping warn-log messages", () => {
  const report = detect([
    { level: 40, msg: "⚠️ shared problem" },
    { repoProblems: ["⚠️ shared problem", "unique problem"] },
  ]);
  // Only the unique problem survives de-dup.
  assert.equal(report.counts["repo-problem"], 1);
});

test("branchesInformation error results become branch-error warnings", () => {
  const report = detect([
    {
      repository: "o/r",
      branchesInformation: [
        { branchName: "renovate/a", result: "pr-created" },
        { branchName: "renovate/b", result: "error" },
      ],
    },
  ]);
  assert.equal(report.counts["branch-error"], 1);
});

test("abandoned-package is reserved and never detected", () => {
  const report = detect([{ level: 50, msg: "x", abandoned: true }]);
  assert.equal(report.counts["abandoned-package"], 0);
});

test("ignore rules suppress matching findings and exit code", () => {
  const { dir, path } = writeTempLog([
    { level: 50, msg: "flaky nuget restore", repository: "o/r" },
  ]);
  const parser = new Parser();
  try {
    parser.load(path);
    const report = new ErrorDetector(parser).run({
      ignoreRules: [{ category: "log-error", message: "*nuget*" }],
    });
    assert.equal(report.findings[0].ignored, true);
    assert.equal(report.summary.errorCount, 0);
    assert.equal(report.exitCode, 0);
    // Raw counts still tally the detected finding.
    assert.equal(report.counts["log-error"], 1);
  } finally {
    parser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-on-warn escalates warnings to a non-zero exit", () => {
  const { dir, path } = writeTempLog([{ level: 40, msg: "warn" }]);
  const parser = new Parser();
  try {
    parser.load(path);
    const report = new ErrorDetector(parser).run({ failOnWarn: true });
    assert.equal(report.exitCode, 1);
  } finally {
    parser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("globToRegExp handles * and ? and escapes literals", () => {
  assert.match("lock file error", globToRegExp("*lock file*"));
  assert.match("abc", globToRegExp("a?c"));
  assert.doesNotMatch("a.c matches only literal dot", globToRegExp("a.c"));
  assert.match("a.c", globToRegExp("a.c"));
});

test("matchIgnoreRule requires all present fields to match", () => {
  const finding = {
    category: "err-object",
    message: "boom",
    repository: "o/r",
  };
  assert.ok(matchIgnoreRule(finding, [{ category: "err-object" }]));
  assert.ok(
    matchIgnoreRule(finding, [{ category: "err-object", repository: "o/r" }]),
  );
  assert.equal(
    matchIgnoreRule(finding, [{ category: "err-object", repository: "x/y" }]),
    undefined,
  );
});

// TODO(Q25): add config-migration pattern coverage once a real migration log
// fixture exists, and expired-rule warning assertions.

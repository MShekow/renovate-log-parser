/**
 * ErrorDetector / ignore-file tests.
 *
 * These tests build tiny synthetic JSONL logs in a temp
 * dir and assert the core detection
 * contracts: category mapping, counts completeness, repo-problem de-dup,
 * ignore-rule matching, and exit codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser } from "../parser.js";
import { ErrorDetector, CATEGORIES } from "../error-detector.js";
import {
  globToRegExp,
  matchIgnoreRule,
  loadIgnoreRules,
} from "../ignore-file.js";

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

test("level 50/60 are errors; err objects and level 40 are warnings", () => {
  const report = detect([
    { level: 50, msg: "boom", repository: "o/r" },
    { level: 60, msg: "fatal" },
    { level: 30, msg: "with err", err: { message: "lock file error" } },
    { level: 40, msg: "just a warning" },
  ]);
  assert.equal(report.counts["log-error"], 1);
  assert.equal(report.counts["log-fatal"], 1);
  assert.equal(report.counts["err-object"], 1);
  assert.equal(report.counts["log-warn"], 1);
  assert.equal(report.summary.errorCount, 2);
  assert.equal(report.summary.warningCount, 2);
  assert.equal(report.exitCode, 1);
});

test("host-error-abort matches 'Repository finished' + external-host-error result", () => {
  const report = detect([
    { level: 30, msg: "Repository finished", result: "done" },
    {
      level: 30,
      msg: "Repository finished",
      result: "external-host-error",
      repository: "o/r",
    },
  ]);
  assert.equal(report.counts["host-error-abort"], 1);
  assert.equal(report.summary.errorCount, 1);
  assert.equal(report.exitCode, 1);
});

test("config-migration matches the exact message plus old/new config pair", () => {
  const report = detect([
    {
      level: 20,
      msg: "Config migration necessary",
      repository: "o/r",
      oldConfig: { extends: ["config:base"] },
      newConfig: { extends: ["config:recommended"] },
    },
    // Same message without the config pair does not count.
    { level: 20, msg: "Config migration necessary" },
  ]);
  assert.equal(report.counts["config-migration"], 1);
  assert.equal(report.summary.errorCount, 1);
  assert.equal(report.exitCode, 1);
});

test("abandoned-package yields one error finding per package", () => {
  const report = detect([
    {
      level: 20,
      msg: "Abandoned package statistics",
      repository: "o/r",
      crate: { rocket: "2024-05-23T20:35:24.000Z" },
      npm: {
        "eslint-plugin-react": "2025-04-03T20:01:15.958Z",
        "orderby-time": "2016-01-14T19:42:40.210Z",
      },
    },
  ]);
  assert.equal(report.counts["abandoned-package"], 3);
  assert.equal(report.summary.errorCount, 3);
  assert.equal(report.exitCode, 1);
  const messages = report.findings
    .filter((f) => f.category === "abandoned-package")
    .map((f) => f.message)
    .sort();
  assert.deepEqual(messages, [
    "crate:rocket",
    "npm:eslint-plugin-react",
    "npm:orderby-time",
  ]);
});

test("repoProblems are de-duped against overlapping log-warn messages", () => {
  const report = detect([
    { level: 40, msg: "⚠️ shared problem" },
    { repoProblems: ["⚠️ shared problem", "unique problem"] },
  ]);
  // Only the unique problem survives de-dup.
  assert.equal(report.counts["repo-problem"], 1);
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

function writeIgnoreFile(rules: object[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "rlp-ignore-"));
  const path = join(dir, "renovate-log-parser.ignore.json");
  writeFileSync(path, JSON.stringify({ version: 1, rules }));
  return { dir, path };
}

test("expired ignore rules are dropped and reported to the warn sink", () => {
  const { dir, path } = writeIgnoreFile([
    { category: "log-error", message: "*nuget*", expires: "2000-01-01" },
  ]);
  const warnings: string[] = [];
  try {
    const rules = loadIgnoreRules(path, { warn: (m) => warnings.push(m) });
    // Expired => not active.
    assert.deepEqual(rules, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /log-error/);
    assert.match(warnings[0], /2000-01-01/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignore rules with a future expiry stay active and do not warn", () => {
  const { dir, path } = writeIgnoreFile([
    { category: "log-error", message: "*nuget*", expires: "2999-01-01" },
  ]);
  const warnings: string[] = [];
  try {
    const rules = loadIgnoreRules(path, { warn: (m) => warnings.push(m) });
    assert.equal(rules.length, 1);
    assert.equal(rules[0].category, "log-error");
    assert.equal(rules[0].expires, "2999-01-01");
    assert.equal(warnings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an expired rule no longer suppresses its finding end-to-end", () => {
  const ignore = writeIgnoreFile([
    { category: "log-error", message: "*nuget*", expires: "2000-01-01" },
  ]);
  const log = writeTempLog([
    { level: 50, msg: "flaky nuget restore", repository: "o/r" },
  ]);
  const parser = new Parser();
  try {
    const ignoreRules = loadIgnoreRules(ignore.path, { warn: () => {} });
    parser.load(log.path);
    const report = new ErrorDetector(parser).run({ ignoreRules });
    // The rule expired and was dropped, so the finding stands.
    assert.equal(report.findings[0].ignored, false);
    assert.equal(report.summary.errorCount, 1);
    assert.equal(report.exitCode, 1);
  } finally {
    parser.close();
    rmSync(ignore.dir, { recursive: true, force: true });
    rmSync(log.dir, { recursive: true, force: true });
  }
});

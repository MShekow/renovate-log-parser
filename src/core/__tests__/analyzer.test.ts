/**
 * Analyzer tests.
 *
 * STUB: Phase 3 scaffolding. These build tiny synthetic JSONL logs in a temp
 * dir (no committed real log — the sample is private, see
 * docs/renovate-log-parser-plan.md, Q25) and assert the core `analyze`
 * contracts: level counts, per-repo line spans, dependency-inventory unioning
 * (root keys + `packageFiles with updates` config), and print-mode
 * range/filter/limit selection, field stripping, and truncation. Flesh out with
 * real fixtures later.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser } from "../parser.js";
import { Analyzer } from "../analyzer.js";
import { parseKeyValueFilter, parseWildcardFilter } from "../filters.js";

function withLog<T>(lines: object[], fn: (analyzer: Analyzer) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "rlp-analyze-"));
  const path = join(dir, "renovate.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const parser = new Parser();
  try {
    parser.load(path);
    return fn(new Analyzer(parser));
  } finally {
    parser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("stats: level counts are tallied and numerically ordered", () => {
  const stats = withLog(
    [
      { level: 40, msg: "warn" },
      { level: 20, msg: "debug" },
      { level: 20, msg: "debug" },
      { level: 30, msg: "info" },
    ],
    (a) => a.stats(),
  );
  assert.deepEqual(stats.levelCounts, { "20": 2, "30": 1, "40": 1 });
  assert.deepEqual(Object.keys(stats.levelCounts), ["20", "30", "40"]);
  assert.equal(stats.totalLines, 4);
});

test("stats: repos carry line spans and unique branches", () => {
  const stats = withLog(
    [
      { level: 20, msg: "no repo" },
      { level: 20, msg: "a", repository: "o/r", branch: "renovate/x" },
      { level: 20, msg: "b", repository: "o/r", branch: "renovate/x" },
      { level: 20, msg: "c", repository: "o/r", branch: "renovate/y" },
    ],
    (a) => a.stats(),
  );
  assert.equal(stats.repos.length, 1);
  const [repo] = stats.repos;
  assert.equal(repo.name, "o/r");
  assert.equal(repo.fromLine, 1);
  assert.equal(repo.toLine, 3);
  assert.deepEqual(repo.branches, ["renovate/x", "renovate/y"]);
});

test("stats: dep/package names union root keys with packageFiles config", () => {
  const stats = withLog(
    [
      { repository: "o/r", depName: "react", packageName: "react" },
      {
        repository: "o/r",
        msg: "packageFiles with updates",
        config: {
          npm: [
            {
              packageFile: "package.json",
              deps: [
                { depName: "react", packageName: "react" },
                { depName: "lodash", packageName: "lodash" },
              ],
            },
          ],
        },
      },
    ],
    (a) => a.stats(),
  );
  const [repo] = stats.repos;
  assert.deepEqual([...repo.depNames].sort(), ["lodash", "react"]);
  assert.deepEqual([...repo.packageNames].sort(), ["lodash", "react"]);
  assert.equal(repo.packageFilesLine, 1);
});

test("stats: branchesInformationLine points at 'branches info extended'", () => {
  const stats = withLog(
    [
      { repository: "o/r", msg: "something else" },
      {
        repository: "o/r",
        msg: "branches info extended",
        branchesInformation: [{ branchName: "renovate/x", result: "done" }],
      },
    ],
    (a) => a.stats(),
  );
  assert.equal(stats.repos[0].branchesInformationLine, 1);
});

test("stats: git-URL (https://) sub-repos are excluded from repos", () => {
  const stats = withLog(
    [
      { level: 30, msg: "real", repository: "owner/repo" },
      {
        level: 30,
        msg: "pre-commit sub-repo",
        repository: "https://github.com/pre-commit/pre-commit-hooks",
      },
    ],
    (a) => a.stats(),
  );
  assert.deepEqual(
    stats.repos.map((r) => r.name),
    ["owner/repo"],
  );
  // Their entries still count toward the whole-log level tally.
  assert.equal(stats.levelCounts["30"], 2);
});

test("print: strips ignored fields but never msg", () => {
  const result = withLog([{ level: 20, msg: "keep", v: 1, time: "t" }], (a) =>
    a.print({
      ignoredFields: ["v", "time", "msg"],
      limit: 50,
      filters: [],
      includeOriginalLine: false,
    }),
  );
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0], { level: 20, msg: "keep" });
});

test("print: line range + filter + limit and truncation notice", () => {
  const lines = [
    { level: 20, msg: "a", repository: "o/r" },
    { level: 20, msg: "b", repository: "o/r" },
    { level: 20, msg: "c", repository: "o/r" },
    { level: 20, msg: "d", repository: "x/y" },
  ];
  const result = withLog(lines, (a) =>
    a.print({
      ignoredFields: [],
      lineFrom: 0,
      lineTo: 2,
      limit: 2,
      filters: [parseKeyValueFilter("repository:o/r")],
      includeOriginalLine: true,
    }),
  );
  assert.equal(result.totalMatched, 3);
  assert.equal(result.emitted, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.entries[0]._oL, 0);
  assert.equal(result.entries[1]._oL, 1);
});

test("print: not truncated when limit covers all matches", () => {
  const result = withLog([{ level: 20, msg: "a" }], (a) =>
    a.print({
      ignoredFields: [],
      limit: 50,
      filters: [],
      includeOriginalLine: false,
    }),
  );
  assert.equal(result.truncated, false);
  assert.equal(result.totalMatched, 1);
});

test("print: wildcard filter matches a prefix, case-insensitively", () => {
  const lines = [
    { level: 20, msg: "Found match at index 1535" },
    { level: 20, msg: "FOUND MATCH AT INDEX 42" },
    { level: 20, msg: "no match here" },
  ];
  const result = withLog(lines, (a) =>
    a.print({
      ignoredFields: [],
      limit: 50,
      filters: [parseWildcardFilter("msg:Found match at*")],
      includeOriginalLine: false,
    }),
  );
  assert.equal(result.totalMatched, 2);
  assert.deepEqual(
    result.entries.map((e) => e.msg),
    ["Found match at index 1535", "FOUND MATCH AT INDEX 42"],
  );
});

test("print: literal % in a wildcard pattern is not a wildcard", () => {
  const lines = [
    { level: 20, msg: "100% done" },
    { level: 20, msg: "100 done" },
  ];
  const result = withLog(lines, (a) =>
    a.print({
      ignoredFields: [],
      limit: 50,
      filters: [parseWildcardFilter("msg:100% done")],
      includeOriginalLine: false,
    }),
  );
  assert.equal(result.totalMatched, 1);
  assert.equal(result.entries[0].msg, "100% done");
});

test("print: wildcard and equals filters combine (AND)", () => {
  const lines = [
    { level: 20, msg: "Found match at 1", repository: "o/r" },
    { level: 20, msg: "Found match at 2", repository: "x/y" },
  ];
  const result = withLog(lines, (a) =>
    a.print({
      ignoredFields: [],
      limit: 50,
      filters: [
        parseKeyValueFilter("repository:o/r"),
        parseWildcardFilter("msg:Found match*"),
      ],
      includeOriginalLine: false,
    }),
  );
  assert.equal(result.totalMatched, 1);
  assert.equal(result.entries[0].repository, "o/r");
});
